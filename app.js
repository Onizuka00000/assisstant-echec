document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyze-btn');
    const usernameInput = document.getElementById('username');
    const statusEl = document.getElementById('status');
    const progressBar = document.getElementById('progress-bar');
    const boardContainer = document.getElementById('analysis-board-container');
    const feedbackContainer = document.getElementById('coach-feedback');
    const feedbackText = document.getElementById('feedback-text');
    const coachTip = document.getElementById('coach-tip');
    
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevKeyBtn = document.getElementById('prev-key-btn');
    const nextKeyBtn = document.getElementById('next-key-btn');
    const toggleArrowsBtn = document.getElementById('toggle-arrows-btn');
    
    const simControls = document.getElementById('sim-controls');
    const showPunishmentBtn = document.getElementById('show-punishment');
    const showBestSimBtn = document.getElementById('show-best-sim');

    const moveInfo = document.getElementById('move-info');
    const moveRating = document.getElementById('move-rating');
    const ratingIcon = document.getElementById('rating-icon');
    const ratingLabel = document.getElementById('rating-label');

    let board = null;
    let workers = [];
    let analysisData = []; 
    let currentMoveIndex = -1;
    let userColor = 'w';
    let isAnimating = false;
    let showArrows = true;

    board = Chessboard('myBoard', {
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });

    async function getWorker() {
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
        const script = await response.text();
        const blob = new Blob([script], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        worker.postMessage('uci');
        return worker;
    }

    function frenchNotation(san) {
        if (!san) return "";
        return san.replace(/K/g, 'R').replace(/Q/g, 'D').replace(/R/g, 'T').replace(/B/g, 'F').replace(/N/g, 'C');
    }

    analyzeBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        if (!username) return;
        resetUI();

        try {
            statusEl.textContent = "Recherche de ta dernière partie...";
            const archivesRes = await fetch(`https://api.chess.com/pub/player/${username}/games/archives`);
            const archivesDataRes = await archivesRes.json();
            const lastMonthUrl = archivesDataRes.archives[archivesDataRes.archives.length - 1];
            const gamesRes = await fetch(lastMonthUrl);
            const gamesData = await gamesRes.json();
            const lastGame = gamesData.games[gamesData.games.length - 1];
            const gameId = lastGame.url;

            // Invalidation cache V3 pour les simulations
            const cached = localStorage.getItem(`chess_analysis_v3_${gameId}`);
            if (cached) {
                statusEl.textContent = "Analyse chargée !";
                const parsed = JSON.parse(cached);
                analysisData = parsed.data;
                userColor = parsed.userColor;
                document.getElementById('opening-text').textContent = parsed.opening;
                document.getElementById('opening-name').classList.remove('hidden');
                finishAnalysis();
                return;
            }

            userColor = lastGame.white.username.toLowerCase() === username.toLowerCase() ? 'w' : 'b';
            const gameParser = new Chess();
            gameParser.load_pgn(lastGame.pgn);
            const history = gameParser.history({ verbose: true });
            
            let openingName = "Ouverture inconnue";
            const openingMatch = lastGame.pgn.match(/\[Opening "(.*?)"\]/);
            if (openingMatch) openingName = openingMatch[1];
            openingName = openingName.replace(/Sicilian Defense/g, "Défense Sicilienne").replace(/Italian Game/g, "Partie Italienne").replace(/Queen's Gambit/g, "Gambit Dame").replace(/French Defense/g, "Défense Française");

            document.getElementById('opening-text').textContent = openingName;
            document.getElementById('opening-name').classList.remove('hidden');

            if (workers.length === 0) {
                workers = await Promise.all([getWorker(), getWorker()]);
            }

            const positions = [];
            const tempTracker = new Chess();
            positions.push({ fen: tempTracker.fen(), move: null });
            for (const m of history) {
                tempTracker.move(m.san);
                positions.push({ fen: tempTracker.fen(), move: m });
            }

            const results = new Array(positions.length);
            let completedCount = 0;
            
            const runTask = async (worker, index) => {
                if (index >= positions.length) return;
                let depth = 10;
                if (index < 10) depth = 6;
                else if (positions[index].move && positions[index].move.color !== userColor) depth = 8;

                results[index] = await analyzePosition(worker, positions[index].fen, depth);
                completedCount++;
                const progress = Math.round((completedCount / positions.length) * 100);
                document.querySelector('.progress-fill').style.width = `${progress}%`;
                statusEl.textContent = `Analyse Dual-Core : ${progress}%`;
                
                await runTask(worker, index + workers.length);
            };

            await Promise.all(workers.map((w, i) => runTask(w, i)));

            analysisData = [];
            for (let i = 1; i < positions.length; i++) {
                const move = history[i-1];
                const evalBefore = results[i-1].eval;
                const evalAfter = results[i].eval;
                const diff = move.color === 'w' ? (evalAfter - evalBefore) : (evalBefore - evalAfter);
                const isBestMove = results[i-1].bestMove === (move.from + move.to);

                let tacticalNote = "";
                if (diff < -3) {
                    if (move.san.includes('Q')) tacticalNote = "Tu as perdu ta Dame !";
                    else if (move.san.includes('R')) tacticalNote = "Une Tour a été perdue.";
                    else tacticalNote = "Perte de matériel importante.";
                }

                analysisData.push({
                    fen: positions[i].fen,
                    san: move.san,
                    eval: evalAfter,
                    rating: classifyMoveChessCom(diff, isBestMove, i),
                    bestMoveSan: results[i-1].bestMoveSan,
                    bestMoveUci: results[i-1].bestMove,
                    bestLine: results[i-1].pv,
                    bestLineUci: results[i-1].pv_uci,
                    punishmentLineUci: results[i].pv_uci,
                    opponentThreat: results[i].pv_uci && results[i].pv_uci.length > 0 ? results[i].pv_uci[0] : null,
                    tacticalNote: tacticalNote,
                    color: move.color
                });
            }

            localStorage.setItem(`chess_analysis_v3_${gameId}`, JSON.stringify({
                data: analysisData,
                userColor,
                opening: openingName
            }));

            finishAnalysis();

        } catch (error) {
            statusEl.textContent = "Erreur : " + error.message;
            analyzeBtn.disabled = false;
        }
    });

    function finishAnalysis() {
        statusEl.textContent = "Prêt !";
        progressBar.classList.add('hidden');
        boardContainer.classList.remove('hidden');
        feedbackContainer.classList.remove('hidden');
        
        setTimeout(() => {
            board.resize();
            currentMoveIndex = -1;
            updateMoveUI();
        }, 100);

        analyzeBtn.disabled = false;
        analyzeBtn.style.opacity = '1';
        analyzeBtn.innerHTML = 'Relancer l\'analyse <span data-lucide="refresh-cw"></span>';
        if (window.lucide) lucide.createIcons();
    }

    function analyzePosition(worker, fen, depth) {
        return new Promise((resolve) => {
            let lastWorkerEval = 0;
            let lastWorkerPv = [];
            let lastWorkerPvUci = [];
            let bestMoveUci = "";

            const timeout = setTimeout(() => {
                worker.removeEventListener('message', onMsg);
                worker.postMessage('stop');
                resolve({ eval: lastWorkerEval, bestMove: "", bestMoveSan: "?", pv: [], pv_uci: [] });
            }, 6000);

            const onMsg = (e) => {
                const msg = e.data;
                if (msg.startsWith('bestmove')) {
                    clearTimeout(timeout);
                    worker.removeEventListener('message', onMsg);
                    bestMoveUci = msg.split(' ')[1];
                    const temp = new Chess(fen);
                    const m = temp.move({ from: bestMoveUci.substring(0,2), to: bestMoveUci.substring(2,4), promotion: 'q' });
                    resolve({ 
                        eval: lastWorkerEval, 
                        bestMove: bestMoveUci, 
                        bestMoveSan: m ? frenchNotation(m.san) : bestMoveUci, 
                        pv: lastWorkerPv,
                        pv_uci: lastWorkerPvUci
                    });
                }
                if (msg.includes('score cp') || msg.includes('score mate')) {
                    const parts = msg.split(' ');
                    if (msg.includes('cp')) lastWorkerEval = parseInt(parts[parts.indexOf('cp') + 1]) / 100;
                    else if (msg.includes('mate')) lastWorkerEval = parseInt(parts[parts.indexOf('mate') + 1]) > 0 ? 15 : -15;

                    if (msg.includes('pv')) {
                        const partsPv = msg.split(' ');
                        const rawPv = partsPv.slice(partsPv.indexOf('pv') + 1, partsPv.indexOf('pv') + 6);
                        lastWorkerPvUci = rawPv;
                        const tempGame = new Chess(fen);
                        lastWorkerPv = rawPv.map(uci => {
                            const m = tempGame.move({ from: uci.substring(0,2), to: uci.substring(2,4), promotion: 'q' });
                            return m ? frenchNotation(m.san) : uci;
                        });
                    }
                }
            };
            
            worker.addEventListener('message', onMsg);
            worker.postMessage(`position fen ${fen}`);
            worker.postMessage(`go depth ${depth}`);
        });
    }

    function classifyMoveChessCom(diff, isBest, moveIndex) {
        if (moveIndex < 10 && diff > -1.5) return { label: 'Book', icon: '📖', class: 'rating-good' };
        if (isBest) return { label: 'Best Move', icon: '⭐', class: 'rating-best' };
        if (diff >= 0) return { label: 'Excellent', icon: '✅', class: 'rating-excellent' };
        if (diff > -0.5) return { label: 'Bon coup', icon: '✅', class: 'rating-good' };
        if (diff > -1.1) return { label: 'Incertain', icon: '❓', class: 'rating-inaccuracy' };
        if (diff > -2.5) return { label: 'Erreur', icon: '❓❓', class: 'rating-mistake' };
        return { label: 'GAFFE', icon: '🔴', class: 'rating-blunder' };
    }

    async function animateToMove(targetIndex) {
        if (isAnimating) return;
        isAnimating = true;
        const direction = targetIndex > currentMoveIndex ? 1 : -1;
        const delay = 120;
        while (currentMoveIndex !== targetIndex) {
            currentMoveIndex += direction;
            board.position(analysisData[currentMoveIndex].fen, true);
            moveInfo.textContent = `Coup ${Math.floor(currentMoveIndex / 2) + 1} (${frenchNotation(analysisData[currentMoveIndex].san)})`;
            await new Promise(r => setTimeout(r, delay));
        }
        isAnimating = false;
        updateMoveUI();
    }

    // NOUVELLE FONCTION DE SIMULATION TACTIQUE
    async function runTacticalSimulation(lineUci) {
        if (isAnimating || !lineUci || lineUci.length === 0) return;
        isAnimating = true;
        clearArrows();
        
        const originalFen = analysisData[currentMoveIndex].fen;
        const simGame = new Chess(originalFen);
        
        for (const moveUci of lineUci.slice(0, 3)) {
            simGame.move({ from: moveUci.substring(0, 2), to: moveUci.substring(2, 4), promotion: 'q' });
            board.position(simGame.fen(), true);
            await new Promise(r => setTimeout(r, 600)); // Vitesse de simulation
        }

        await new Promise(r => setTimeout(r, 1500)); // Pause pour observer le résultat
        board.position(originalFen, true);
        isAnimating = false;
        updateMoveUI();
    }

    showPunishmentBtn.addEventListener('click', () => {
        const data = analysisData[currentMoveIndex];
        runTacticalSimulation(data.punishmentLineUci);
    });

    showBestSimBtn.addEventListener('click', () => {
        const data = analysisData[currentMoveIndex];
        // Pour simuler le meilleur coup, on doit d'abord jouer le meilleur coup lui-même
        if (data.bestLineUci) runTacticalSimulation(data.bestLineUci);
    });

    function clearArrows() {
        document.getElementById('drawing-layer').innerHTML = '';
    }

    function drawArrow(uci, type) {
        if (!uci || uci.length < 4) return;
        const from = uci.substring(0, 2);
        const to = uci.substring(2, 4);
        
        const svg = document.getElementById('drawing-layer');
        if (!svg) return;
        
        const squareSize = 100 / 8;

        const getCoords = (sq) => {
            const col = sq.charCodeAt(0) - 97;
            const row = 8 - parseInt(sq[1]);
            const finalCol = userColor === 'w' ? col : 7 - col;
            const finalRow = userColor === 'w' ? row : 7 - row;
            return {
                x: (finalCol + 0.5) * squareSize,
                y: (finalRow + 0.5) * squareSize
            };
        };

        const start = getCoords(from);
        const end = getCoords(to);

        const color = type === 'best' ? 'rgba(129, 182, 76, 0.85)' : 'rgba(250, 49, 35, 0.85)';
        const markerId = type === 'best' ? 'arrowhead-green' : 'arrowhead-red';

        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        arrow.setAttribute('x1', start.x);
        arrow.setAttribute('y1', start.y);
        arrow.setAttribute('x2', end.x);
        arrow.setAttribute('y2', end.y);
        arrow.setAttribute('stroke', color);
        arrow.setAttribute('stroke-width', '1.8');
        arrow.setAttribute('stroke-linecap', 'round');
        arrow.setAttribute('marker-end', `url(#${markerId})`);

        svg.appendChild(arrow);
    }

    toggleArrowsBtn.addEventListener('click', () => {
        showArrows = !showArrows;
        toggleArrowsBtn.classList.toggle('active', showArrows);
        toggleArrowsBtn.innerHTML = showArrows ? '<i data-lucide="eye"></i>' : '<i data-lucide="eye-off"></i>';
        if (window.lucide) lucide.createIcons();
        updateMoveUI();
    });

    prevBtn.addEventListener('click', () => { if (!isAnimating && currentMoveIndex >= 0) { currentMoveIndex--; updateMoveUI(); } });
    nextBtn.addEventListener('click', () => { if (!isAnimating && currentMoveIndex < analysisData.length - 1) { currentMoveIndex++; updateMoveUI(); } });

    nextKeyBtn.addEventListener('click', () => {
        if (isAnimating) return;
        for (let i = currentMoveIndex + 1; i < analysisData.length; i++) {
            const rating = analysisData[i].rating.label;
            if (analysisData[i].color === userColor && (rating === 'GAFFE' || rating === 'Erreur' || rating === 'Best Move' || rating === 'Excellent')) {
                animateToMove(i);
                break;
            }
        }
    });

    prevKeyBtn.addEventListener('click', () => {
        if (isAnimating) return;
        for (let i = currentMoveIndex - 1; i >= 0; i--) {
            const rating = analysisData[i].rating.label;
            if (analysisData[i].color === userColor && (rating === 'GAFFE' || rating === 'Erreur' || rating === 'Best Move' || rating === 'Excellent')) {
                animateToMove(i);
                break;
            }
        }
    });

    function updateMoveUI() {
        clearArrows();
        if (currentMoveIndex === -1) {
            board.position('start', true);
            moveInfo.textContent = "Début";
            moveRating.classList.add('hidden');
            simControls.classList.add('hidden');
            return;
        }

        const data = analysisData[currentMoveIndex];
        board.position(data.fen, true);
        moveInfo.textContent = `Coup ${Math.floor(currentMoveIndex / 2) + 1} (${frenchNotation(data.san)})`;
        
        const displayEval = Math.max(-5, Math.min(5, data.eval));
        const percent = ((displayEval + 5) / 10) * 100;
        document.getElementById('eval-fill').style.height = `${percent}%`;
        const evalText = document.getElementById('eval-score-text');
        evalText.textContent = Math.abs(data.eval).toFixed(1);

        if (data.color !== userColor) {
            moveRating.classList.add('hidden');
            simControls.classList.add('hidden');
            feedbackText.innerHTML = `<div class="opponent-move-label">Coup de l'adversaire (${frenchNotation(data.san)})</div>`;
            return;
        }

        moveRating.classList.remove('hidden');
        moveRating.className = 'move-rating ' + data.rating.class;
        ratingIcon.textContent = data.rating.icon;
        ratingLabel.textContent = data.rating.label;

        // Gestion des boutons de simulation
        simControls.classList.remove('hidden');
        const isBad = data.rating.label === 'GAFFE' || data.rating.label === 'Erreur' || data.rating.label === 'Incertain';
        showPunishmentBtn.classList.toggle('hidden', !isBad);
        showBestSimBtn.classList.toggle('hidden', data.rating.label === 'Best Move');

        let msg = "";
        if (data.rating.label === 'Best Move') {
            msg = "C'est le meilleur coup ! Tu as trouvé la suite précise recommandée par l'ordinateur.";
        } else if (data.rating.label === 'Excellent') {
            msg = "C'est un excellent coup, tu améliores ta position.";
        } else {
            if (data.rating.label === 'Book') msg = "C'est de la théorie. Tu joues l'ouverture parfaitement !";
            else if (data.rating.label === 'Incertain') msg = "Ce coup est un peu imprécis.";
            else if (data.rating.label === 'Erreur') msg = "C'est une erreur tactique.";
            else if (data.rating.label === 'GAFFE') msg = "Aïe... C'est une gaffe.";
            else msg = "C'est un coup solide.";

            if (data.tacticalNote) {
                msg = `<span class="tactical-warning">⚠️ ${data.tacticalNote}</span><br>` + msg;
                if (showArrows && data.opponentThreat) drawArrow(data.opponentThreat, 'threat');
            }

            if (showArrows && data.bestMoveUci) drawArrow(data.bestMoveUci, 'best');

            const line = data.bestLine && data.bestLine.length > 0 ? `<br><span class="simulation-text">Simulation : ${data.bestLine.join(' ')} ...</span>` : "";
            msg += `<br><div class="best-move-suggestion">Le meilleur coup était : <strong>${data.bestMoveSan}</strong>${line}</div>`;
        }
        
        feedbackText.innerHTML = msg;
        coachTip.textContent = `Analyse Turbo (Dual-Core)`;
    }

    function resetUI() {
        feedbackContainer.classList.add('hidden');
        boardContainer.classList.add('hidden');
        progressBar.classList.remove('hidden');
        document.querySelector('.progress-fill').style.width = '0%';
        analyzeBtn.disabled = true;
        analyzeBtn.style.opacity = '0.6';
    }
});

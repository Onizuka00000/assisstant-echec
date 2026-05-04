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
    const moveInfo = document.getElementById('move-info');
    const moveRating = document.getElementById('move-rating');
    const ratingIcon = document.getElementById('rating-icon');
    const ratingLabel = document.getElementById('rating-label');

    let board = null;
    let stockfish = null;
    let analysisData = []; 
    let currentMoveIndex = -1;
    let userColor = 'w';

    board = Chessboard('myBoard', {
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });

    async function initStockfish() {
        if (stockfish) return stockfish;
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
        const script = await response.text();
        const blob = new Blob([script], { type: 'application/javascript' });
        stockfish = new Worker(URL.createObjectURL(blob));
        stockfish.postMessage('uci');
        stockfish.postMessage('isready');
        return stockfish;
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
            statusEl.textContent = "Accès Chess.com...";
            const archivesRes = await fetch(`https://api.chess.com/pub/player/${username}/games/archives`);
            const archivesData = await archivesRes.json();
            if (!archivesData.archives.length) throw new Error("Aucune partie.");
            
            const lastMonthUrl = archivesData.archives[archivesData.archives.length - 1];
            const gamesRes = await fetch(lastMonthUrl);
            const gamesData = await gamesRes.json();
            const lastGame = gamesData.games[gamesData.games.length - 1];

            userColor = lastGame.white.username.toLowerCase() === username.toLowerCase() ? 'w' : 'b';

            const engine = await initStockfish();
            const gameParser = new Chess();
            gameParser.load_pgn(lastGame.pgn);
            const history = gameParser.history({ verbose: true });
            
            let openingName = "Ouverture inconnue";
            const openingMatch = lastGame.pgn.match(/\[Opening "(.*?)"\]/);
            if (openingMatch) openingName = openingMatch[1];
            openingName = openingName.replace(/Sicilian Defense/g, "Défense Sicilienne").replace(/Italian Game/g, "Partie Italienne").replace(/Queen's Gambit/g, "Gambit Dame").replace(/French Defense/g, "Défense Française");

            document.getElementById('opening-text').textContent = openingName;
            document.getElementById('opening-name').classList.remove('hidden');

            const analysisTracker = new Chess();
            analysisData = [];
            let lastEval = 0.3;

            for (let i = 0; i < history.length; i++) {
                const move = history[i];
                const fenBefore = analysisTracker.fen();
                statusEl.textContent = `Analyse Turbo : ${Math.round((i / history.length) * 100)}%`;
                
                let depth = 10;
                if (i < 8) depth = 6;
                else if (move.color !== userColor) depth = 8;

                const result = await analyzePosition(engine, fenBefore, lastEval, depth);
                
                analysisTracker.move(move.san);
                const currentFen = analysisTracker.fen();
                
                const diff = move.color === 'w' ? (result.eval - lastEval) : (lastEval - result.eval);
                const isBestMove = move.from + move.to === result.bestMove;

                let tacticalNote = "";
                if (diff < -3) {
                    if (move.san.includes('Q')) tacticalNote = "Tu as perdu ta Dame !";
                    else if (move.san.includes('R')) tacticalNote = "Une Tour a été perdue.";
                    else tacticalNote = "Perte de matériel importante.";
                }

                analysisData.push({
                    fen: currentFen,
                    san: move.san,
                    eval: result.eval,
                    rating: classifyMoveChessCom(diff, isBestMove, i),
                    bestMoveSan: result.bestMoveSan,
                    bestLine: result.pv,
                    tacticalNote: tacticalNote,
                    color: move.color
                });

                lastEval = result.eval;
                document.querySelector('.progress-fill').style.width = `${Math.round(((i + 1) / history.length) * 100)}%`;
            }

            setTimeout(() => {
                statusEl.textContent = "Analyse Terminée !";
                progressBar.classList.add('hidden');
                boardContainer.classList.remove('hidden');
                feedbackContainer.classList.remove('hidden');
                board.resize();
                currentMoveIndex = -1;
                updateMoveUI();
                analyzeBtn.disabled = false;
                analyzeBtn.style.opacity = '1';
                analyzeBtn.innerHTML = 'Relancer l\'analyse <span data-lucide="refresh-cw"></span>';
                if (window.lucide) lucide.createIcons();
            }, 600);

        } catch (error) {
            statusEl.textContent = "Erreur : " + error.message;
            analyzeBtn.disabled = false;
        }
    });

    function analyzePosition(engine, fen, fallbackEval, depth) {
        return new Promise((resolve) => {
            let latestEval = fallbackEval;
            let pvSan = [];
            const timeout = setTimeout(() => {
                engine.removeEventListener('message', onMsg);
                resolve({ eval: latestEval, bestMove: "", bestMoveSan: "?", pv: [] });
            }, 5000);

            const onMsg = (e) => {
                const msg = e.data;
                if (msg.includes('score cp') || msg.includes('score mate')) {
                    const parts = msg.split(' ');
                    if (msg.includes('cp')) latestEval = parseInt(parts[parts.indexOf('cp') + 1]) / 100;
                    else if (msg.includes('mate')) latestEval = parseInt(parts[parts.indexOf('mate') + 1]) > 0 ? 15 : -15;

                    if (msg.includes('pv')) {
                        const partsPv = msg.split(' ');
                        const rawPv = partsPv.slice(partsPv.indexOf('pv') + 1, partsPv.indexOf('pv') + 5);
                        const tempGame = new Chess(fen);
                        pvSan = rawPv.map(uci => {
                            const m = tempGame.move({ from: uci.substring(0,2), to: uci.substring(2,4), promotion: 'q' });
                            return m ? frenchNotation(m.san) : uci;
                        });
                    }
                }
                if (msg.startsWith('bestmove')) {
                    clearTimeout(timeout);
                    engine.removeEventListener('message', onMsg);
                    const bestMoveUci = msg.split(' ')[1];
                    const temp = new Chess(fen);
                    const m = temp.move({ from: bestMoveUci.substring(0,2), to: bestMoveUci.substring(2,4), promotion: 'q' });
                    resolve({ eval: latestEval, bestMove: bestMoveUci, bestMoveSan: m ? frenchNotation(m.san) : bestMoveUci, pv: pvSan });
                }
            };
            engine.addEventListener('message', onMsg);
            engine.postMessage(`position fen ${fen}`);
            engine.postMessage(`go depth ${depth}`);
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

    prevBtn.addEventListener('click', () => { if (currentMoveIndex >= 0) { currentMoveIndex--; updateMoveUI(); } });
    nextBtn.addEventListener('click', () => { if (currentMoveIndex < analysisData.length - 1) { currentMoveIndex++; updateMoveUI(); } });

    // NAVIGATION PAR MOMENTS CLÉS
    nextKeyBtn.addEventListener('click', () => {
        for (let i = currentMoveIndex + 1; i < analysisData.length; i++) {
            const rating = analysisData[i].rating.label;
            if (analysisData[i].color === userColor && (rating === 'GAFFE' || rating === 'Erreur' || rating === 'Best Move' || rating === 'Excellent')) {
                currentMoveIndex = i;
                updateMoveUI();
                break;
            }
        }
    });

    prevKeyBtn.addEventListener('click', () => {
        for (let i = currentMoveIndex - 1; i >= 0; i--) {
            const rating = analysisData[i].rating.label;
            if (analysisData[i].color === userColor && (rating === 'GAFFE' || rating === 'Erreur' || rating === 'Best Move' || rating === 'Excellent')) {
                currentMoveIndex = i;
                updateMoveUI();
                break;
            }
        }
    });

    function updateMoveUI() {
        if (currentMoveIndex === -1) {
            board.position('start', true);
            moveInfo.textContent = "Début";
            moveRating.classList.add('hidden');
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
        evalText.style.top = data.eval >= 0 ? 'auto' : '5px';
        evalText.style.bottom = data.eval >= 0 ? '5px' : 'auto';
        evalText.style.color = data.eval >= 0 ? '#312e2b' : '#bab9b8';

        if (data.color !== userColor) {
            moveRating.classList.add('hidden');
            feedbackText.innerHTML = `<div class="opponent-move-label">Coup de l'adversaire (${frenchNotation(data.san)})</div>`;
            return;
        }

        moveRating.classList.remove('hidden');
        moveRating.className = 'move-rating ' + data.rating.class;
        ratingIcon.textContent = data.rating.icon;
        ratingLabel.textContent = data.rating.label;

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
            }

            const line = data.bestLine && data.bestLine.length > 0 ? `<br><span class="simulation-text">Simulation : ${data.bestLine.join(' ')} ...</span>` : "";
            msg += `<br><div class="best-move-suggestion">Le meilleur coup était : <strong>${data.bestMoveSan}</strong>${line}</div>`;
        }
        
        feedbackText.innerHTML = msg;
        coachTip.textContent = `Analyse Turbo (Profondeur variable)`;
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

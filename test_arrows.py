from playwright.sync_api import sync_playwright
import time
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    # Capture console logs
    page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Browser error: {err}"))
    
    # Navigate to local server
    page.goto('http://localhost:8000')
    page.wait_for_load_state('networkidle')
    
    # Fill username and click analyze
    page.fill('#username', 'chachafa')
    page.click('#analyze-btn')
    
    print("Waiting for analysis to finish...")
    # Wait for the board container to be visible (not hidden)
    page.wait_for_selector('#analysis-board-container:not(.hidden)', timeout=15000)
    
    time.sleep(1) # wait for resize
    
    # Click "Next Key Moment" 2 times to find a blunder
    print("Clicking next key moment...")
    page.click('#next-key-btn')
    time.sleep(0.5)
    page.click('#next-key-btn')
    time.sleep(0.5)
    page.click('#next-key-btn')
    time.sleep(1)
    
    # Ensure arrows are toggled on (default is true, but let's click eye to toggle off then on to test)
    # page.click('#toggle-arrows-btn')
    # time.sleep(0.5)
    # page.click('#toggle-arrows-btn')
    # time.sleep(0.5)
    
    # Print the DOM of the drawing-layer
    svg_html = page.locator('#drawing-layer').inner_html()
    print("SVG Content:", svg_html)
    
    # Get bounding box of the SVG
    box = page.locator('#drawing-layer').bounding_box()
    print("SVG Box:", box)
    
    board_box = page.locator('#myBoard').bounding_box()
    print("Board Box:", board_box)
    
    # Take screenshot
    page.screenshot(path='/Users/thomasgonzalez/.gemini/antigravity/brain/30aca51c-7e39-46d0-8229-b8a7d1749ee8/artifacts/arrows_test.png', full_page=True)
    
    browser.close()

// Connect to Render backend if in production, otherwise localhost
const SERVER_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://multiplayer-bingo-6v6h.onrender.com';

const socket = io(SERVER_URL, {
    transports: ['polling'], // Force polling to bypass WebSocket issues
    reconnectionAttempts: 5,
    timeout: 20000,
});

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    // alert('Connected!'); 
});

socket.on('connect_error', (err) => {
    console.error('Connection Error Details:', err);
    // Only alert on persistent failure to avoid spamming
    if (socket.active) {
        console.log('Retrying connection...');
    } else {
        alert(`Connection Failed: ${err.message}. Check console for details.`);
    }
});

// DOM Elements
const mainMenu = document.getElementById('main-menu');
const computerMenu = document.getElementById('computer-menu');
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');

// Buttons
const pvpBtn = document.getElementById('pvp-btn');
const computerBtn = document.getElementById('computer-btn');
const basicBotBtn = document.getElementById('basic-bot-btn');
const aiBotBtn = document.getElementById('ai-bot-btn');
const backToMainBtn = document.getElementById('back-to-main-btn');
const backToMainFromLogin = document.getElementById('back-to-main-from-login');

const usernameInput = document.getElementById('username');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('room-code-input');

const roomCodeText = document.getElementById('room-code-text');
const copyCodeBtn = document.getElementById('copy-code-btn');
const playersUl = document.getElementById('players-ul');
const hostControls = document.getElementById('host-controls');
const startGameBtn = document.getElementById('start-game-btn');
const waitingMsg = document.getElementById('waiting-msg');

const gridElement = document.getElementById('grid');
const playerNameEl = document.getElementById('player-name');
const opponentNameEl = document.getElementById('opponent-name');
const statusMsg = document.getElementById('status-message');
const linesCountEl = document.getElementById('lines-count');
const resultTitle = document.getElementById('result-title');
const restartBtn = document.getElementById('restart-btn');
const timerBar = document.getElementById('timer-bar');
const timerText = document.getElementById('timer-text');
const botBoardWrapper = document.getElementById('bot-board-wrapper');
const botGridElement = document.getElementById('bot-grid');

const playerHealthEl = document.getElementById('player-health');
const opponentHealthEl = document.getElementById('opponent-health');

// Game State
let gameMode = 'pvp'; // 'pvp', 'basic-bot', 'ai-bot'
let gameState = {
    phase: 'calling', // 'calling' | 'marking'
    currentNumber: null,
    isMyTurn: false
};
let myGrid = [];
let botGrid = [];
let botMarked = new Set();
let playerMarked = new Set(); // For local game tracking
let localTimer;

// Local state for simultaneous marking
let localPlayerMarkedCurrent = false;
let localBotMarkedCurrent = false;

// Health State (Local)
let playerLives = 3;
let botLives = 3;

// Force hide result screen on load
resultScreen.classList.add('hidden');
console.log('Script loaded, result screen hidden');

// --- Sound Manager ---

class SoundManager {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this.bgm = {
            main: new Audio('music/main music.mp3'),
            game: new Audio('music/ingame music.mp3')
        };

        // Configure BGM
        Object.values(this.bgm).forEach(audio => {
            audio.loop = true;
            audio.volume = 0.4;
        });

        this.currentBGM = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.playBGM('main');
        } else if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggleMute() {
        this.muted = !this.muted;

        // Handle BGM
        Object.values(this.bgm).forEach(audio => {
            audio.muted = this.muted;
        });

        // Update Button UI
        const btn = document.getElementById('mute-btn');
        if (this.muted) {
            btn.textContent = '🔇';
            btn.classList.add('muted');
        } else {
            btn.textContent = '🔊';
            btn.classList.remove('muted');
        }

        return this.muted;
    }

    playBGM(type) {
        if (this.currentBGM) {
            this.currentBGM.pause();
            this.currentBGM.currentTime = 0;
        }

        if (type === 'main') {
            this.currentBGM = this.bgm.main;
        } else if (type === 'game') {
            this.currentBGM = this.bgm.game;
        }

        if (this.currentBGM && !this.muted) {
            this.currentBGM.play().catch(e => console.log('Audio play failed (user interaction needed):', e));
        }
    }

    playSFX(type) {
        if (this.muted || !this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        const now = this.ctx.currentTime;

        switch (type) {
            case 'click':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;

            case 'mark':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, now);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;

            case 'call':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1200, now);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);
                break;

            case 'warning':
                osc.type = 'square';
                osc.frequency.setValueAtTime(300, now);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;

            case 'win':
                // Major Arpeggio
                this.playNote(523.25, now, 0.1); // C5
                this.playNote(659.25, now + 0.1, 0.1); // E5
                this.playNote(783.99, now + 0.2, 0.2); // G5
                this.playNote(1046.50, now + 0.3, 0.4); // C6
                break;

            case 'lose':
                // Descending Minor
                this.playNote(783.99, now, 0.2); // G5
                this.playNote(622.25, now + 0.2, 0.2); // Eb5
                this.playNote(523.25, now + 0.4, 0.4); // C5
                break;
        }
    }

    playNote(freq, time, duration) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0.1, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

        osc.start(time);
        osc.stop(time + duration);
    }
}

const soundManager = new SoundManager();

// Show Main Menu on Load
window.addEventListener('load', () => {
    console.log('Window loaded, showing main menu');
    showScreen(mainMenu);

    // Init audio on first click anywhere
    document.body.addEventListener('click', () => {
        soundManager.init();
    }, { once: true });
});

const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundManager.toggleMute();
});

// --- Navigation ---

pvpBtn.addEventListener('click', () => {
    gameMode = 'pvp';
    showScreen(loginScreen);
});

computerBtn.addEventListener('click', () => {
    showScreen(computerMenu);
});

backToMainBtn.addEventListener('click', () => {
    showScreen(mainMenu);
});

backToMainFromLogin.addEventListener('click', () => {
    showScreen(mainMenu);
});

basicBotBtn.addEventListener('click', () => {
    gameMode = 'basic-bot';
    startComputerGame('Basic Bot');
});

const GEMINI_API_KEY = 'AIzaSyBzzJOEE9QscuIn5gOtswpU1hvbLzIEIj8';

aiBotBtn.addEventListener('click', () => {
    gameMode = 'ai-bot';
    startComputerGame('AI Bot');
});

function showScreen(screen) {
    [mainMenu, computerMenu, loginScreen, lobbyScreen, gameScreen, resultScreen].forEach(s => s.classList.add('hidden'));
    screen.classList.remove('hidden');
}

// --- Socket Events ---

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
});

socket.on('roomCreated', (data) => {
    roomCodeText.textContent = data.roomId;
    updatePlayersList([data.username]);
    showScreen(lobbyScreen);
    hostControls.classList.remove('hidden');
    waitingMsg.classList.add('hidden');
});

socket.on('joinedRoom', (data) => {
    roomCodeText.textContent = data.roomId;
    updatePlayersList([data.host, data.username]);
    showScreen(lobbyScreen);
    hostControls.classList.add('hidden');
    waitingMsg.classList.remove('hidden');
});

socket.on('playerJoined', (username) => {
    const currentPlayers = Array.from(playersUl.children).map(li => li.textContent);
    updatePlayersList([...currentPlayers, username]);
});

socket.on('gameStart', (data) => {
    showScreen(gameScreen);
    soundManager.playBGM('game');
    renderGrid(data.grid);
    opponentNameEl.textContent = data.opponent;
    playerNameEl.textContent = usernameInput.value || 'Player';
    gameState.isMyTurn = data.isTurn;
    gameState.phase = 'calling';
    resetHealthUI();
    updateStatus();
});

socket.on('numberCalled', (data) => {
    // PvP: Opponent called a number
    gameState.phase = 'marking';
    gameState.currentNumber = data.number;

    // Highlight the number to mark (optional visual cue)
    // For now, just update status
    updateStatus();
});

socket.on('numberMarked', (data) => {
    // PvP: Number was marked.
    // We handle local marking immediately on click.
});

socket.on('turnSwitch', (turnId) => {
    gameState.isMyTurn = (socket.id === turnId);
    gameState.phase = 'calling';
    gameState.currentNumber = null;
    updateStatus();
});

socket.on('timerUpdate', (data) => {
    // Handle both old (number) and new (object) formats for backward compatibility during dev
    const timeLeft = typeof data === 'object' ? data.timeLeft : data;
    updateTimerUI(timeLeft);
});

socket.on('healthUpdate', (data) => {
    console.log('Received healthUpdate:', data);
    if (data.playerId === socket.id) {
        console.log('Updating MY health');
        updateHealthUI(playerHealthEl, data.lives);
    } else {
        console.log('Updating OPPONENT health');
        updateHealthUI(opponentHealthEl, data.lives);
    }
});

socket.on('gameOver', (data) => {
    showResult(data.winner);
});

socket.on('error', (msg) => {
    alert(msg);
});

// --- PvP Logic ---

createRoomBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        socket.emit('createRoom', username);
        playerNameEl.textContent = username;
    } else {
        alert('Please enter a name');
    }
});

joinRoomBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomCodeInput.value.trim();
    if (username && roomId) {
        socket.emit('joinRoom', { username, roomId });
        playerNameEl.textContent = username;
    } else {
        alert('Please enter name and room code');
    }
});

startGameBtn.addEventListener('click', () => {
    socket.emit('startGame', roomCodeText.textContent);
});

// --- Game Logic ---

function handleCellClick(cell, num) {
    if (gameMode === 'pvp') {
        if (gameState.phase === 'calling') {
            if (!gameState.isMyTurn) return;
            if (cell.classList.contains('marked')) return;

            // Call the number
            socket.emit('callNumber', num);
            soundManager.playSFX('call');

            // Auto-mark for caller
            markCell(num);
            statusMsg.textContent = "Waiting for opponent to mark...";

        } else if (gameState.phase === 'marking') {
            // Everyone can mark if it's the current number
            if (gameState.currentNumber === num) {
                if (cell.classList.contains('marked')) return; // Already marked

                socket.emit('markNumber', num);
                markCell(num); // Mark locally immediately
                soundManager.playSFX('mark');
                statusMsg.textContent = "Waiting for other players...";
            }
        }
    } else {
        // Local / Bot Game
        handleLocalClick(num);
    }
}

function updateStatus() {
    if (gameMode === 'pvp') {
        if (gameState.phase === 'calling') {
            statusMsg.textContent = gameState.isMyTurn ? "Your turn to call!" : "Opponent is calling...";
        } else {
            // Marking phase
            statusMsg.textContent = gameState.isMyTurn ?
                `Waiting for opponent to mark ${gameState.currentNumber}...` :
                `Mark number ${gameState.currentNumber}!`;
        }
    } else {
        // Bot Game
        if (gameState.phase === 'calling') {
            statusMsg.textContent = gameState.isMyTurn ? "Your turn to call!" : `${opponentNameEl.textContent} is calling...`;
        } else {
            statusMsg.textContent = gameState.isMyTurn ?
                `Waiting for ${opponentNameEl.textContent} to mark...` :
                `Mark number ${gameState.currentNumber}!`;
        }
    }
}

// --- Vs Computer Logic ---

function startComputerGame(botName) {
    gameMode = botName === 'Basic Bot' ? 'basic-bot' : 'ai-bot';
    showScreen(gameScreen);
    soundManager.playBGM('game');

    // Show Bot Board
    if (botBoardWrapper) {
        botBoardWrapper.classList.remove('hidden');
    }

    const numbers = Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    renderGrid(numbers);

    // Bot Setup
    botGrid = Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    renderBotGrid(botGrid);

    botMarked = new Set();
    playerMarked = new Set();

    playerNameEl.textContent = 'You';
    opponentNameEl.textContent = botName;

    gameState.isMyTurn = true; // Player starts
    gameState.phase = 'calling';

    // Reset Lives
    playerLives = 3;
    botLives = 3;
    resetHealthUI();

    startLocalTimer();
}


function handleLocalClick(num) {
    if (gameState.phase === 'calling') {
        if (!gameState.isMyTurn) return;
        if (playerMarked.has(num)) return;

        // Auto-mark for player (caller) IMMEDIATELY
        markCell(num);
        soundManager.playSFX('call');
        playerMarked.add(num);
        localPlayerMarkedCurrent = true;
        localBotMarkedCurrent = false;

        // Player calls number
        gameState.currentNumber = num;
        gameState.phase = 'marking';

        statusMsg.textContent = "Waiting for opponent...";
        resetLocalTimer();

        // Bot "marks" it (simulated delay)
        setTimeout(() => {
            handleBotMark(num);
        }, 1500);

    } else if (gameState.phase === 'marking') {
        if (gameState.currentNumber !== num) return;
        if (localPlayerMarkedCurrent) return; // Already marked

        // Player marks
        markCell(num);
        soundManager.playSFX('mark');
        playerMarked.add(num);
        localPlayerMarkedCurrent = true;
        statusMsg.textContent = "Waiting for opponent...";

        checkLocalTurnSwitch();
    }
}

function makeBasicBotMove() {
    // Bot calls a number
    const available = botGrid.filter(n => !botMarked.has(n));
    const num = available[Math.floor(Math.random() * available.length)];

    gameState.currentNumber = num;
    gameState.phase = 'marking';
    localPlayerMarkedCurrent = false;
    localBotMarkedCurrent = false;

    updateStatus();
    resetLocalTimer();

    // Bot marks its own number immediately (or with delay)
    setTimeout(() => {
        handleBotMark(num);
    }, 500);
}

async function makeAIBotMove() {
    console.log('makeAIBotMove called');
    // AI Bot calls a number
    const available = botGrid.filter(n => !botMarked.has(n));

    // Fallback to random if API fails or returns invalid
    let num = available[Math.floor(Math.random() * available.length)];

    try {
        const prompt = `Play Bingo. 
        My Grid (5x5): ${botGrid.join(',')}. 
        Marked Numbers: ${Array.from(botMarked).join(',')}. 
        Available to call: ${available.join(',')}. 
        Goal: Pick the ONE best number from the 'Available to call' list to maximize chances of completing a line (row, column, or diagonal). 
        Return ONLY the number, no text.`;

        console.log('Calling Gemini API...');
        const aiResponse = await callGeminiAI(prompt);
        console.log('Gemini API Response:', aiResponse);

        const parsedNum = parseInt(aiResponse.trim());

        if (!isNaN(parsedNum) && available.includes(parsedNum)) {
            num = parsedNum;
            console.log('AI chose valid number:', num);
        } else {
            console.warn('AI returned invalid number:', aiResponse);
        }
    } catch (error) {
        console.error('AI Error:', error);
    }

    gameState.currentNumber = num;
    gameState.phase = 'marking';
    localPlayerMarkedCurrent = false;
    localBotMarkedCurrent = false;

    updateStatus();
    resetLocalTimer();

    // Bot marks its own number immediately (or with delay)
    setTimeout(() => {
        handleBotMark(num);
    }, 500);
}

async function callGeminiAI(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
    console.log('Fetching URL:', url);
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error Response:', errorText);
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('API Data:', data);
    return data.candidates[0].content.parts[0].text;
}

function handleBotMark(number) {
    // Bot marks on its internal grid
    botMarked.add(number);
    localBotMarkedCurrent = true;
    checkLocalTurnSwitch();
}

function checkLocalTurnSwitch() {
    if (localPlayerMarkedCurrent && localBotMarkedCurrent) {
        // Both marked -> Switch Turn

        // Reveal number on Bot's Grid
        const botCells = botGridElement.querySelectorAll('.cell');
        botCells.forEach(cell => {
            if (parseInt(cell.dataset.number) === gameState.currentNumber) {
                cell.textContent = gameState.currentNumber;
                cell.classList.add('revealed');
                cell.classList.add('marked');
            }
        });

        // Check Win
        const pWin = checkLines(playerMarked, myGrid);
        const bWin = checkLines(botMarked, botGrid);

        if (pWin && bWin) endLocalGame('Draw');
        else if (pWin) endLocalGame('You');
        else if (bWin) endLocalGame(opponentNameEl.textContent);
        else {
            // Switch Turn
            gameState.isMyTurn = !gameState.isMyTurn;
            gameState.phase = 'calling';
            gameState.currentNumber = null;
            updateStatus();
            resetLocalTimer();

            if (!gameState.isMyTurn) {
                if (gameMode === 'ai-bot') {
                    setTimeout(makeAIBotMove, 1000);
                } else {
                    setTimeout(makeBasicBotMove, 1000);
                }
            }
        }
    }
}

function startLocalTimer() {
    clearInterval(localTimer);
    let timeLeft = 30;
    updateTimerUI(timeLeft);

    localTimer = setInterval(() => {
        timeLeft--;
        updateTimerUI(timeLeft);

        if (timeLeft <= 0) {
            // Timeout Logic
            clearInterval(localTimer);
            handleLocalTimeout();
        }
    }, 1000);
}

function handleLocalTimeout() {
    // Identify who timed out
    let timedOutIsPlayer = false;

    if (gameState.phase === 'calling') {
        timedOutIsPlayer = gameState.isMyTurn;
    } else {
        // Marking phase
        // If player hasn't marked, they timed out
        if (!localPlayerMarkedCurrent) timedOutIsPlayer = true;
        // If bot hasn't marked, bot timed out (simulated)
        else if (!localBotMarkedCurrent) timedOutIsPlayer = false;
    }

    if (timedOutIsPlayer) {
        playerLives--;
        updateHealthUI(playerHealthEl, playerLives);
        if (playerLives <= 0) {
            endLocalGame(opponentNameEl.textContent);
            return;
        }
    } else {
        botLives--;
        updateHealthUI(opponentHealthEl, botLives);
        if (botLives <= 0) {
            endLocalGame('You');
            return;
        }
    }

    // Switch turn regardless
    gameState.isMyTurn = !gameState.isMyTurn;
    gameState.phase = 'calling';
    gameState.currentNumber = null;
    localPlayerMarkedCurrent = false;
    localBotMarkedCurrent = false;

    updateStatus();
    resetLocalTimer();

    if (!gameState.isMyTurn) {
        if (gameMode === 'ai-bot') {
            setTimeout(makeAIBotMove, 1000);
        } else {
            setTimeout(makeBasicBotMove, 1000);
        }
    }
}

function resetLocalTimer() {
    startLocalTimer();
}

function endLocalGame(winner) {
    clearInterval(localTimer);
    showResult(winner);
}

// --- Helper Functions ---

function updateTimerUI(timeLeft) {
    if (timeLeft < 0) timeLeft = 0;
    const percentage = (timeLeft / 30) * 100;
    timerBar.style.width = `${percentage}%`;
    timerText.textContent = timeLeft;

    if (timeLeft <= 5) {
        timerBar.style.backgroundColor = '#ff4444';
        if (timeLeft > 0) soundManager.playSFX('warning');
    } else {
        timerBar.style.backgroundColor = '#00ff88';
    }
}

function resetHealthUI() {
    updateHealthUI(playerHealthEl, 3);
    updateHealthUI(opponentHealthEl, 3);
}

function updateHealthUI(element, lives) {
    const hearts = element.querySelectorAll('.heart');
    hearts.forEach((heart, index) => {
        if (index < lives) {
            heart.classList.remove('lost');
        } else {
            heart.classList.add('lost');
        }
    });
}

function markCell(num) {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => {
        if (parseInt(cell.dataset.number) === num) {
            cell.classList.add('marked');
        }
    });
}

function checkLines(markedSet, grid) {
    // For local game, we check against the set of marked numbers and the grid layout
    // Grid is a flat array of 25 numbers
    if (!grid || grid.length !== 25) return 0;

    let lines = 0;
    const isMarked = (num) => markedSet.has(num);

    // Rows
    for (let r = 0; r < 5; r++) {
        if ([0, 1, 2, 3, 4].every(c => isMarked(grid[r * 5 + c]))) lines++;
    }
    // Cols
    for (let c = 0; c < 5; c++) {
        if ([0, 1, 2, 3, 4].every(r => isMarked(grid[r * 5 + c]))) lines++;
    }
    // Diagonals
    if ([0, 6, 12, 18, 24].every(i => isMarked(grid[i]))) lines++;
    if ([4, 8, 12, 16, 20].every(i => isMarked(grid[i]))) lines++;

    return lines >= 5;
}

function renderGrid(numbers) {
    myGrid = numbers;
    gridElement.innerHTML = '';
    myGrid.forEach(num => {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.textContent = num;
        cell.dataset.number = num;

        cell.addEventListener('click', () => {
            handleCellClick(cell, num);
        });

        gridElement.appendChild(cell);
    });
}

function renderBotGrid(numbers) {
    if (!botGridElement) return;
    botGridElement.innerHTML = '';
    numbers.forEach(num => {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.number = num;
        // Text content is empty initially (hidden)
        botGridElement.appendChild(cell);
    });
}

function updatePlayersList(players) {
    playersUl.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p;
        playersUl.appendChild(li);
    });
}

copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(roomCodeText.textContent);
    copyCodeBtn.textContent = '✅';
    setTimeout(() => copyCodeBtn.textContent = '📋', 2000);
});

function showResult(winner) {
    let msg = '';
    if (winner === 'draw') {
        msg = "It's a Draw!";
        soundManager.playSFX('lose');
    } else if (winner === 'You' || winner === playerNameEl.textContent) {
        msg = "You Won!";
        soundManager.playSFX('win');
    } else {
        msg = `${winner} Won!`;
        soundManager.playSFX('lose');
    }
    resultTitle.textContent = msg;
    resultScreen.classList.remove('hidden');
}

restartBtn.addEventListener('click', () => {
    location.reload();
});

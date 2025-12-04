const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity (or specify Vercel URL later)
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const rooms = {};

function generateGrid() {
    const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    return numbers;
}

function checkWin(grid, calledNumbers) {
    const isMarked = (num) => calledNumbers.has(num);
    let lines = 0;

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

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (username) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            players: [{ id: socket.id, username, lives: 3 }],
            grids: {},
            usernames: { [socket.id]: username },
            calledNumbers: new Set(),
            turn: socket.id,
            timer: null,
            timeLeft: 30,
            host: socket.id,
            gameStarted: false,
            phase: 'calling', // 'calling' or 'marking'
            currentNumber: null,
            markedPlayers: new Set()
        };

        rooms[roomId].grids[socket.id] = generateGrid();
        socket.join(roomId);

        socket.emit('roomCreated', { roomId, username });
        console.log(`Room ${roomId} created by ${username}`);
    });

    socket.on('joinRoom', ({ username, roomId }) => {
        roomId = roomId.toUpperCase();
        const room = rooms[roomId];

        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        if (room.players.length >= 2) {
            socket.emit('error', 'Room is full');
            return;
        }

        if (room.gameStarted) {
            socket.emit('error', 'Game already started');
            return;
        }

        room.players.push({ id: socket.id, username, lives: 3 });
        room.usernames[socket.id] = username;
        room.grids[socket.id] = generateGrid();
        socket.join(roomId);

        // Notify host
        io.to(room.host).emit('playerJoined', username);

        // Notify joiner
        socket.emit('joinedRoom', {
            roomId,
            host: room.usernames[room.host],
            username
        });

        console.log(`${username} joined room ${roomId}`);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.host !== socket.id) return;
        if (room.players.length !== 2) return;

        room.gameStarted = true;
        const p1 = room.players[0].id;
        const p2 = room.players[1].id;
        room.turn = p1; // Host starts

        io.to(p1).emit('gameStart', {
            grid: rooms[roomId].grids[p1],
            opponent: rooms[roomId].usernames[p2],
            isTurn: true
        });
        io.to(p2).emit('gameStart', {
            grid: rooms[roomId].grids[p2],
            opponent: rooms[roomId].usernames[p1],
            isTurn: false
        });

        startTimer(roomId);
    });

    socket.on('callNumber', (number) => {
        // Find room
        let roomId = null;
        for (const id in rooms) {
            if (rooms[id].players.some(p => p.id === socket.id)) {
                roomId = id;
                break;
            }
        }

        if (roomId && rooms[roomId].players.length === 2) {
            const room = rooms[roomId];
            if (room.turn !== socket.id) return; // Not your turn
            if (room.phase !== 'calling') return; // Wrong phase
            if (room.calledNumbers.has(number)) return; // Already called

            room.calledNumbers.add(number);
            room.currentNumber = number;
            room.phase = 'marking'; // Switch to marking phase
            room.markedPlayers = new Set(); // Reset marked players
            room.markedPlayers.add(socket.id); // Caller automatically marks

            // Notify both - BUT DO NOT SWITCH TURN YET
            io.to(roomId).emit('numberCalled', {
                number: number,
                caller: socket.id
            });

            // Start 30s timer for marking
            startTimer(roomId);
        }
    });

    socket.on('markNumber', (number) => {
        // Find room
        let roomId = null;
        for (const id in rooms) {
            if (rooms[id].players.some(p => p.id === socket.id)) {
                roomId = id;
                break;
            }
        }

        if (roomId) {
            const room = rooms[roomId];
            if (room.phase !== 'marking') return;
            if (room.currentNumber !== number) return;

            room.markedPlayers.add(socket.id);

            // Check if all players have marked
            if (room.markedPlayers.size === room.players.length) {
                switchTurn(roomId);
                io.to(roomId).emit('turnSwitch', room.turn);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Handle disconnect (cleanup room)
        for (const id in rooms) {
            if (rooms[id].players.some(p => p.id === socket.id)) {
                clearInterval(rooms[id].timer);
                io.to(id).emit('playerDisconnected');
                delete rooms[id];
                break;
            }
        }
    });
});

function startTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    clearInterval(room.timer);
    room.timeLeft = 30;

    io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, phase: room.phase });

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(roomId).emit('timerUpdate', { timeLeft: room.timeLeft, phase: room.phase });

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            handleTimeout(roomId);
        }
    }, 1000);
}

function handleTimeout(roomId) {
    console.log(`Timeout in room ${roomId}`);
    const room = rooms[roomId];
    if (!room) return;

    // Identify who timed out
    let timedOutPlayerId;
    if (room.phase === 'calling') {
        timedOutPlayerId = room.turn;
        console.log(`Phase calling. Turn was: ${room.turn}`);
    } else {
        // In marking phase, find who hasn't marked
        const pendingPlayers = room.players.filter(p => !room.markedPlayers.has(p.id));
        if (pendingPlayers.length > 0) {
            timedOutPlayerId = pendingPlayers[0].id;
            console.log(`Phase marking. Pending player: ${timedOutPlayerId}`);
        }
    }

    if (timedOutPlayerId) {
        const player = room.players.find(p => p.id === timedOutPlayerId);
        if (player) {
            player.lives--;
            console.log(`Player ${player.username} lost a life. Lives left: ${player.lives}`);
            io.to(roomId).emit('healthUpdate', { playerId: timedOutPlayerId, lives: player.lives });

            if (player.lives <= 0) {
                // Game Over
                const winner = room.players.find(p => p.id !== timedOutPlayerId);
                io.to(roomId).emit('gameOver', { winner: winner.username });
                delete rooms[roomId];
                return;
            }
        } else {
            console.error('Timed out player not found in room players list');
        }
    } else {
        console.log('No player identified for timeout penalty');
    }

    // Switch turn regardless of phase to keep game moving
    switchTurn(roomId);
    io.to(roomId).emit('turnSwitch', room.turn);
}

function switchTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const p1 = room.players[0].id;
    const p2 = room.players[1].id;

    // Check wins before switching
    let winner = null;
    const p1Win = checkWin(room.grids[p1], room.calledNumbers);
    const p2Win = checkWin(room.grids[p2], room.calledNumbers);

    if (p1Win && p2Win) winner = 'draw';
    else if (p1Win) winner = room.players[0].username;
    else if (p2Win) winner = room.players[1].username;

    if (winner) {
        clearInterval(room.timer);
        io.to(roomId).emit('gameOver', { winner });
        delete rooms[roomId];
        return;
    }

    room.turn = (room.turn === p1) ? p2 : p1;
    room.phase = 'calling'; // Reset to calling phase
    room.currentNumber = null;

    io.to(roomId).emit('turnSwitch', room.turn);
    startTimer(roomId);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

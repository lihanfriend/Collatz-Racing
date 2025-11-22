// index.js (module) - Collatz Duel with Firebase Auth + RTDB
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, update, get } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

// -------------------------
// Firebase config & init
// -------------------------
const firebaseConfig = {
    apiKey: "AIzaSyB9oK73wo05B6YHViDTUsh2gT-04G4FpP8",
    authDomain: "collatz-racing.firebaseapp.com",
    databaseURL: "https://collatz-racing-default-rtdb.firebaseio.com",
    projectId: "collatz-racing",
    storageBucket: "collatz-racing.firebasestorage.app",
    messagingSenderId: "78351409018",
    appId: "1:78351409018:web:ff8ecfd3e6018f896dc0c3",
    measurementId: "G-5J0FS12HGE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getDatabase(app);

// -------------------------
// Game & duel state
// -------------------------
let currentUser = null;
let duelID = null;
let startNumber = null;
let currentNum = null, stepCount = 0;
let opponentData = { currentNumber: null, steps: 0 };
let timerInterval = null, startTime = 0;
let sequence = [];
let duelRef = null;

// -------------------------
// DOM refs
// -------------------------
const $ = id => document.getElementById(id);
const loginScreen = $('loginScreen');
const duelLobby = $('duelLobby');
const gameScreen = $('gameScreen');
const resultScreen = $('resultScreen');

// -------------------------
// Auth listener
// -------------------------
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        loginScreen.classList.add('hidden');
        duelLobby.classList.remove('hidden');
        $('userInfo').textContent = `Signed in as: ${user.displayName || 'Anonymous'}`;
        $('userInfo').classList.remove('hidden');
    } else {
        loginScreen.classList.remove('hidden');
        duelLobby.classList.add('hidden');
        $('userInfo').classList.add('hidden');
    }
});

// -------------------------
// Login/Logout wiring
// -------------------------
$('loginBtn').addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        console.error("Sign-in error:", err);
        alert("Sign-in failed. See console for details.");
    }
});

$('logoutBtn').addEventListener('click', async () => {
    try {
        await signOut(auth);
        // reset UI state if needed
        duelID = null;
        duelRef = null;
        startNumber = null;
        $('duelStatus').textContent = '';
    } catch (err) {
        console.error("Sign-out error:", err);
        alert("Sign-out failed. See console.");
    }
});

// -------------------------
// Collatz helpers
// -------------------------
function collatzStep(n){ return n % 2 === 0 ? n / 2 : 3 * n + 1; }
function getTotalSteps(n){ let t = n, c = 0; while(t !== 1){ t = collatzStep(t); c++; } return c; }
function generateStartingNumber(){
    while(true){
        const n = Math.floor(Math.random() * 100) + 10; // 10..109
        const s = getTotalSteps(n);
        if(s >= 5 && s <= 20) return n;
    }
}

// -------------------------
// Duel Create/Join
// -------------------------
$('createDuelBtn').addEventListener('click', async () => {
    if(!currentUser){ alert("Please sign in first."); return; }
    startNumber = generateStartingNumber();
    const duelsRef = ref(db, 'duels');
    duelRef = push(duelsRef);
    duelID = duelRef.key;

    const payload = {
        startNumber,
        status: 'pending',
        player1: {
            uid: currentUser.uid,
            displayName: currentUser.displayName || 'Anonymous',
            currentNumber: startNumber,
            steps: 0,
            finished: false
        }
    };

    try {
        await set(duelRef, payload);
        $('duelStatus').textContent = `Duel created! ID: ${duelID}. Waiting for opponent...`;
        listenDuel();
    } catch (err) {
        console.error("Error creating duel:", err);
        alert("Failed to create duel.");
    }
});

$('joinDuelBtn').addEventListener('click', async () => {
    if(!currentUser){ alert("Please sign in first."); return; }
    const inputID = $('duelIDInput').value.trim();
    if(!inputID){ alert("Enter a duel ID"); return; }

    duelID = inputID;
    duelRef = ref(db, `duels/${duelID}`);

    try {
        const snap = await get(duelRef);
        const data = snap.exists() ? snap.val() : null;
        if(!data){ alert("Duel not found!"); duelID = null; duelRef = null; return; }

        if(!data.player2 && data.status === 'pending'){
            startNumber = data.startNumber;
            const player2Ref = ref(db, `duels/${duelID}/player2`);
            await set(player2Ref, {
                uid: currentUser.uid,
                displayName: currentUser.displayName || 'Anonymous',
                currentNumber: startNumber,
                steps: 0,
                finished: false
            });
            const statusRef = ref(db, `duels/${duelID}/status`);
            await set(statusRef, 'active');
            $('duelStatus').textContent = `Joined duel ${duelID}. Game starting!`;
            listenDuel();
            startGame(); // start locally for the joining player
        } else if(data.status === 'active'){
            alert("Duel already in progress!");
        } else {
            alert("Cannot join this duel.");
        }
    } catch (err) {
        console.error("Error joining duel:", err);
        alert("Failed to join duel.");
    }
});

// -------------------------
// Listen for duel updates
// -------------------------
function listenDuel(){
    if(!duelRef) return;
    onValue(duelRef, snapshot => {
        const data = snapshot.val();
        if(!data) return;

        // determine which player is opponent
        let opponentKey = 'player2';
        if(data.player1 && data.player1.uid === (currentUser && currentUser.uid)) opponentKey = 'player2';
        else opponentKey = 'player1';

        // if opponent exists, update their display
        if(data[opponentKey]){
            opponentData.currentNumber = data[opponentKey].currentNumber;
            opponentData.steps = data[opponentKey].steps;
            $('opponentNumber').textContent = opponentData.currentNumber;
            $('opponentStepCount').textContent = opponentData.steps;
        }

        // if both finished -> show result
        if(data.player1 && data.player2 && data.player1.finished && data.player2.finished){
            const winner = determineWinner(data);
            showResult(winner, data);
        }
    });
}

// -------------------------
// Start Game (local)
 // -------------------------
function startGame(){
    currentNum = startNumber;
    stepCount = 0;
    sequence = [currentNum];
    duelLobby.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    $('currentNumber').textContent = currentNum;
    $('stepCount').textContent = stepCount;
    $('answerInput').value = '';
    $('answerInput').disabled = false;
    $('feedback').textContent = '';
    startTime = Date.now();
    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 100);
    setTimeout(()=> $('answerInput').focus(), 120);
}

// -------------------------
// Timer
// -------------------------
function updateTimer(){
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    $('timer').textContent = elapsed + 's';
}

// -------------------------
// Submit Answer
// -------------------------
$('submitBtn').addEventListener('click', submitAnswer);
$('answerInput').addEventListener('keypress', e => { if(e.key === 'Enter') submitAnswer(); });

async function submitAnswer(){
    if(!duelID){ $('feedback').textContent = 'No duel active.'; return; }
    const input = $('answerInput');
    const answer = parseInt(input.value);
    const correct = collatzStep(currentNum);
    const feedback = $('feedback');
    if(isNaN(answer)){ feedback.textContent = '⚠️ Enter a number!'; feedback.className='text-yellow-400'; return; }

    // resolve player key
    const playerKey = await getPlayerKey();
    if(!playerKey){ alert("Couldn't resolve player key."); return; }

    if(answer !== correct){
        clearInterval(timerInterval);
        $('answerInput').disabled = true;
        feedback.textContent = `✗ WRONG! (${currentNum} → ${correct})`;
        feedback.className='text-red-400';
        // mark finished in DB
        await update(ref(db, `duels/${duelID}/${playerKey}`), { finished: true });
        return;
    }

    // correct
    currentNum = answer;
    stepCount++;
    sequence.push(currentNum);
    $('currentNumber').textContent = currentNum;
    $('stepCount').textContent = stepCount;

    // update RTDB
    await update(ref(db, `duels/${duelID}/${playerKey}`), {
        currentNumber: currentNum,
        steps: stepCount
    });

    feedback.textContent = '✓ Correct!'; feedback.className='text-green-400';
    input.value = ''; input.focus();

    if(currentNum === 1){
        clearInterval(timerInterval);
        await update(ref(db, `duels/${duelID}/${playerKey}`), { finished: true });
    }
}

// -------------------------
// Determine winner
// -------------------------
function determineWinner(duelData){
    const p1 = duelData.player1;
    const p2 = duelData.player2;
    if(!p1 || !p2) return null;

    // If both finished (or reached 1), lower steps wins. If tied, p1 wins by <= as original logic.
    if((p1.currentNumber === 1 || p1.finished) && (p2.currentNumber === 1 || p2.finished)){
        return (p1.steps <= p2.steps) ? p1.displayName : p2.displayName;
    } else if(p1.currentNumber === 1 || p1.finished){
        return p1.displayName;
    } else if(p2.currentNumber === 1 || p2.finished){
        return p2.displayName;
    }
    return null;
}

// -------------------------
// Show result
// -------------------------
function showResult(winner, duelData){
    gameScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    $('resultTitle').textContent = winner ? `Winner: ${winner}` : 'Draw!';
    $('resultEmoji').textContent = winner ? '🏆' : '🤝';
    $('finalSteps').textContent = stepCount;
    $('finalTime').textContent = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
}

// -------------------------
// Return to Lobby
// -------------------------
$('returnLobbyBtn').addEventListener('click', () => {
    resultScreen.classList.add('hidden');
    duelLobby.classList.remove('hidden');
    // optional: cleanup duel record (if you want)
});

// -------------------------
// Helpers
// -------------------------
async function getPlayerKey(){
    if(!duelRef) return null;
    const snap = await get(duelRef);
    const data = snap.exists() ? snap.val() : null;
    if(!data) return null;
    if(data.player1 && data.player1.uid === (currentUser && currentUser.uid)) return 'player1';
    if(data.player2 && data.player2.uid === (currentUser && currentUser.uid)) return 'player2';
    return null;
}

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const canvas = document.getElementById('tetrisCanvas');
    const context = canvas.getContext('2d');
    const holdCanvas = document.getElementById('holdCanvas');
    const holdContext = holdCanvas.getContext('2d');
    const nextCanvas = document.getElementById('nextCanvas');
    const nextContext = nextCanvas.getContext('2d');
    const scoreElement = document.getElementById('score');
    const levelElement = document.getElementById('level');
    const gameOverScreen = document.getElementById('gameOverScreen');
    const finalScoreElement = document.getElementById('finalScore');
    const retryButton = document.getElementById('retryButton');
    const pauseScreen = document.getElementById('pauseScreen');

    // --- Audio Manager ---
    const sfx = {
        move: new Audio('sfx/move.mp3'),
        rotate: new Audio('sfx/rotate.mp3'),
        softDrop: new Audio('sfx/soft_drop.mp3'),
        hardDrop: new Audio('sfx/hard_drop.mp3'),
        lineClear: new Audio('sfx/line_clear.mp3'),
        tetris: new Audio('sfx/tetris.mp3'),
        hold: new Audio('sfx/hold.mp3'),
        gameOver: new Audio('sfx/game_over.mp3'),
        bgm: new Audio('sfx/bgm.mp3'),
    };

    // BGMのプロパティを設定
    sfx.bgm.loop = true;
    sfx.bgm.volume = 0.3; // 音量を30%に設定


    // Function to play sound without interrupting previous playback
    function playSound(sound) {
        // Allows the sound to be replayed quickly
        sound.currentTime = 0;
        // .catch() handles potential errors if the browser blocks autoplay
        sound.play().catch(e => console.error("Audio play failed:", e));
    }

    // --- Constants ---
    const COLS = 10; // ボードの幅（列数）
    const ROWS = 20; // ボードの高さ（行数）
    const BLOCK_SIZE = canvas.width / COLS; // 1ブロックのサイズを計算

    const GAME_STATE = {
        PLAYING: 'playing',
        PAUSED: 'paused',
        GAME_OVER: 'gameOver'
    };

    // --- テトリミノの定義 ---
    const COLORS = {
        'I': { r: 0, g: 255, b: 255 },   // cyan
        'J': { r: 0, g: 0, b: 255 },     // blue
        'L': { r: 255, g: 165, b: 0 },  // orange
        'O': { r: 255, g: 255, b: 0 },  // yellow
        'S': { r: 0, g: 255, b: 0 },     // lime
        'T': { r: 128, g: 0, b: 128 },   // purple
        'Z': { r: 255, g: 0, b: 0 }      // red
    };

    const TETROMINOES = {
        'I': { matrix: [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]] },
        'J': { matrix: [[1,0,0], [1,1,1], [0,0,0]] },
        'L': { matrix: [[0,0,1], [1,1,1], [0,0,0]] },
        'O': { matrix: [[1,1], [1,1]] },
        'S': { matrix: [[0,1,1], [1,1,0], [0,0,0]] },
        'T': { matrix: [[0,1,0], [1,1,1], [0,0,0]] },
        'Z': { matrix: [[1,1,0], [0,1,1], [0,0,0]] }
    };

    const PIECES = 'IJLOSTZ';

    // --- Game State Variables ---
    let board = createEmptyBoard();
    let player = {
        pos: { x: 0, y: 0 },
        matrix: null,
        type: null,
    };
    let score = 0;
    let level = 1;
    let nextPieceType = null; // 次のテトリミノのタイプ
    let holdPieceType = null; // ホールド中のテトリミノのタイプ
    let canHold = true;       // 現在のミノでホールドが可能かどうかのフラグ
    let dropCounter = 0;
    let dropInterval = 1000; // 1秒 (1000ms) ごとに落下
    let lastTime = 0;
    let animationFrameId = null;
    let gameState; // The single source of truth for the game's state
    let lineClearEffects = []; // ライン消去エフェクト用
    let comboCounter = 0;
    let gameEffects = []; // For text, particles, etc.

    // --- ゲームロジック関数 ---

    /**
     * 空のゲームボード（2次元配列）を作成します。
     * @returns {(number|string)[][]} 0で満たされた2次元配列
     */
    function createEmptyBoard() {
        return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    }

    /**
     * テトリミノとボードの衝突をチェックします。
     * @param {object} piece - チェックするテトリミノ (matrix, posを持つ)
     * @returns {boolean} 衝突していればtrue
     */
    function collisionCheck(piece) {
        const { matrix, pos } = piece;
        for (let y = 0; y < matrix.length; y++) {
            for (let x = 0; x < matrix[y].length; x++) {
                // 1. テトリミノのブロック部分かチェック
                if (matrix[y][x] !== 0) {
                    // 2. ボード上の座標を計算
                    let newY = y + pos.y;
                    let newX = x + pos.x;

                    // 3. 衝突判定
                    if (
                        newX < 0 || newX >= COLS || newY >= ROWS || // a. 壁または床の外か？
                        (board[newY] && board[newY][newX] !== 0)      // b. 他ブロックと衝突したか？
                    ) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * 操作中のテトリミノをボードに固定（マージ）します。
     */
    function mergeIntoBoard() {
        const { matrix, pos, type } = player;
        for (let y = 0; y < matrix.length; y++) {
            for (let x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x] !== 0) {
                    // ゲームオーバー判定：ブロックが画面上部にはみ出して確定した場合
                    if (y + pos.y < 0) {
                        handleGameOver();
                        return; // ゲームオーバーなので処理を中断
                    }
                    board[y + pos.y][x + pos.x] = type;
                }
            }
        }
    }

    /**
     * 揃った行を消去し、スコアを加算します。
     */
    function boardSweep() {
        let clearedLines = 0;
        outer: for (let y = board.length - 1; y >= 0; --y) {
            for (let x = 0; x < board[y].length; ++x) {
                if (board[y][x] === 0) {
                    // この行は揃っていないので、次の行へ
                    continue outer;
                }
            }

            // この行は揃っている
            const [removedRow] = board.splice(y, 1); // 揃った行を削除
            board.unshift(Array(COLS).fill(0));      // 新しい空の行を一番上に追加

            // この行に消去エフェクトを追加
            lineClearEffects.push({ y: y, alpha: 1.0 });

            clearedLines++;

            // 行を削除したため、同じyインデックスを再度チェックする必要がある
            y++;
        }

        // スコア計算
        if (clearedLines > 0) {
            if (clearedLines === 4) {
                playSound(sfx.tetris);
            } else {
                playSound(sfx.lineClear);
            }
            // 1行: 100, 2行: 300, 3行: 500, 4行(Tetris): 800
            const linePoints = [0, 100, 300, 500, 800];
            score += linePoints[clearedLines] * level;
            scoreElement.innerText = score;

            // レベルアップのロジック (1000点ごとにレベルアップ)
            const nextLevelThreshold = level * 1000;
            if (score >= nextLevelThreshold) {
                level++;
                levelElement.innerText = level;
                // 落下速度を更新 (レベルが上がるごとに速くする)
                dropInterval = Math.max(150, 1000 - (level - 1) * 75);
            }
        }

        return clearedLines;
    }

    /**
     * ブロックが確定した際の処理をまとめた関数
     */
    function lockPiece() {
        mergeIntoBoard();
        if (gameState === GAME_STATE.GAME_OVER) return; // Check if mergeIntoBoard triggered game over

        const clearedLines = boardSweep();

        if (clearedLines > 0) {
            comboCounter++;
        } else {
            // ラインを消せなかったらコンボはリセット
            comboCounter = 0;
        }

        triggerEffects(clearedLines);
        advancePiece();
    }

    /**
     * 消去ライン数やコンボ数に応じて演出を発生させます。
     * @param {number} clearedLines - 今回消去したライン数
     */
    function triggerEffects(clearedLines) {
        // Level 3: Multi-line clear effects
        switch (clearedLines) {
            case 2:
                gameEffects.push({ type: 'text', text: 'DOUBLE', lifetime: 60, initialLifetime: 60, size: 30, y: 200, color: { r: 97, g: 218, b: 251 } });
                break;
            case 3:
                gameEffects.push({ type: 'text', text: 'TRIPLE', lifetime: 75, initialLifetime: 75, size: 35, y: 200, color: { r: 240, g: 173, b: 78 } });
                break;
            case 4:
                gameEffects.push({ type: 'text', text: 'TETRIS', lifetime: 90, initialLifetime: 90, size: 40, y: 200, color: { r: 217, g: 83, b: 79 } });
                // Add a border flash effect for Tetris
                gameEffects.push({ type: 'borderFlash', lifetime: 30, initialLifetime: 30 });
                break;
        }

        // Level 2: Combo effects
        if (comboCounter >= 2) {
            gameEffects.push({
                type: 'text',
                text: `${comboCounter} COMBO!`,
                lifetime: 60, // 60フレーム (約1秒)
                initialLifetime: 60,
                size: 25 + comboCounter, // コンボ数に応じてサイズアップ
                y: 250,
                color: { r: 255, g: 215, b: 0 } // Gold
            });
        }
    }

    // --- Drawing Functions ---

    /**
     * 1つのブロックを描画します。
     * @param {CanvasRenderingContext2D} ctx - 描画対象のコンテキスト
     * @param {number} x - ブロックのX座標（列）
     * @param {number} y - ブロックのY座標（行）
     * @param {object|string} color - 描画する色 (e.g., {r,g,b} or 'rgba(...)')
     * @param {number} [size=BLOCK_SIZE] - ブロックのサイズ
     * @param {string} [outline='#1a1a1a'] - 境界線の色
     */
    function drawBlock(ctx, x, y, color, size = BLOCK_SIZE, outline = '#1a1a1a') {
        if (typeof color === 'object' && color !== null) {
            ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
        } else {
            ctx.fillStyle = color; // For rgba strings like the ghost piece
        }
        ctx.fillRect(x * size, y * size, size, size);
        ctx.strokeStyle = outline;
        ctx.strokeRect(x * size, y * size, size, size);
    }

    /**
     * サイドパネル（Hold, Next）にテトリミノを描画する共通関数
     * @param {CanvasRenderingContext2D} ctx - 描画対象のコンテキスト
     * @param {string} type - 描画するテトリミノのタイプ
     */
    function drawSidePiece(ctx, type) {
        const canvas = ctx.canvas;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (type) {
            const piece = TETROMINOES[type];
            const color = COLORS[type];
            const matrix = piece.matrix;
            const blockSize = canvas.width / 4; // Assume 4x4 grid for side panels

            // 4x4グリッドの中央に描画するためのオフセット計算
            const matrixSize = matrix.length;
            const offsetX = (4 - matrixSize) / 2;
            const offsetY = (4 - matrixSize) / 2;

            matrix.forEach((row, y) => {
                row.forEach((value, x) => {
                    if (value !== 0) {
                        drawBlock(ctx, x + offsetX, y + offsetY, color, blockSize, '#000');
                    }
                });
            });
        }
    }

    /**
     * メインの描画処理。毎フレーム呼び出されます。
     */
    function draw() {
        // Main board
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        board.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    drawBlock(context, x, y, COLORS[value]);
                }
            });
        });

        // Draw Ghost Piece
        if (gameState === GAME_STATE.PLAYING && player.matrix) {
            const ghost = JSON.parse(JSON.stringify(player)); // Deep clone
            while (!collisionCheck(ghost)) {
                ghost.pos.y++;
            }
            ghost.pos.y--;

            const color = COLORS[ghost.type];
            ghost.matrix.forEach((row, y) => {
                row.forEach((value, x) => {
                    if (value !== 0) {
                        // Draw a semi-transparent block for the ghost
                        const ghostColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.2)`;
                        drawBlock(context, ghost.pos.x + x, ghost.pos.y + y, ghostColor);
                    }
                });
            });
        }

        // Current piece
        if (player.matrix) {
            const { matrix, pos, type } = player;
            const color = COLORS[type];
            matrix.forEach((row, y) => {
                row.forEach((value, x) => {
                    if (value !== 0) {
                        drawBlock(context, pos.x + x, pos.y + y, color);
                    }
                });
            });
        }

        // Draw line clear effects
        for (const effect of lineClearEffects) {
            context.fillStyle = `rgba(255, 255, 255, ${effect.alpha})`;
            context.fillRect(0, effect.y * BLOCK_SIZE, canvas.width, BLOCK_SIZE);
        }

        // Draw border flash effect
        const borderFlash = gameEffects.find(e => e.type === 'borderFlash');
        if (borderFlash) {
            const progress = 1 - (borderFlash.lifetime / borderFlash.initialLifetime);
            const alpha = Math.sin(progress * Math.PI); // Fades in and out
            context.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            context.lineWidth = 4;
            context.strokeRect(0, 0, canvas.width, canvas.height);
        }

        // Draw game effects (text, etc.)
        context.save();
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (const effect of gameEffects) {
            if (effect.type === 'text') {
                // 少しずつ大きくなってから消えるアニメーション
                const progress = 1 - (effect.lifetime / effect.initialLifetime);
                const scale = 1 + progress * 0.5;
                const alpha = 1 - progress;

                context.font = `bold ${effect.size * scale}px Arial`;
                context.fillStyle = `rgba(${effect.color.r}, ${effect.color.g}, ${effect.color.b}, ${alpha})`;
                context.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.7})`;
                context.lineWidth = 4;
                context.strokeText(effect.text, canvas.width / 2, effect.y);
                context.fillText(effect.text, canvas.width / 2, effect.y);
            }
        }
        context.restore();

        // Side panels
        drawSidePiece(holdContext, holdPieceType);
        drawSidePiece(nextContext, nextPieceType);
    }

    // --- Player Actions ---

    /**
     * 指定されたタイプのテトリミノでプレイヤーをリセットします。
     * @param {string} type - 'I', 'J', 'L'などのテトリミノのタイプ
     */
    function resetPlayer(type) {
        const matrix = TETROMINOES[type].matrix;
        player.type = type;
        player.matrix = matrix;

        // Y座標の初期位置を、ブロックの上部が空行でない最初の行が
        // 画面の上端に来るように調整する
        player.pos.y = 0;
        for (let y = 0; y < matrix.length; y++) {
            if (matrix[y].every(value => value === 0)) {
                player.pos.y--;
            } else {
                break;
            }
        }
        player.pos.x = Math.floor(COLS / 2) - Math.floor(player.matrix[0].length / 2);

        // ゲームオーバーチェック
        if (collisionCheck(player)) {
            handleGameOver();
        }
    }

    /**
     * 次のテトリミノを準備し、プレイヤーを更新します。
     */
    function advancePiece() {
        canHold = true;
        resetPlayer(nextPieceType);
        if (gameState === GAME_STATE.GAME_OVER) return;
        nextPieceType = PIECES[Math.floor(Math.random() * PIECES.length)];
    }

    /**
     * プレイヤーのテトリミノを1段下に落とします。
     * 衝突した場合は、固定して新しいミノを生成します。
     */
    function playerDrop() {
        if (gameState !== GAME_STATE.PLAYING) return;
        player.pos.y++;
        if (collisionCheck(player)) {
            player.pos.y--;
            lockPiece();
        }
        dropCounter = 0; // ドロップカウンターをリセット
    }

    /**
     * ユーザー操作による1段落下（効果音付き）
     */
    function userPlayerDrop() {
        player.pos.y++;
        if (collisionCheck(player)) {
            player.pos.y--; // 衝突したので動かさない
        } else {
            playSound(sfx.softDrop);
        }
        dropCounter = 0; // 落下タイマーをリセット
    }

    /**
     * プレイヤーのテトリミノを左右に動かします。
     * @param {number} direction - 移動方向 (-1: 左, 1: 右)
     */
    function playerMove(direction) {
        player.pos.x += direction;
        if (collisionCheck(player)) {
            player.pos.x -= direction; // 衝突したら元に戻す
        } else {
            playSound(sfx.move);
        }
    }

    /**
     * 行列を右に90度回転させます。
     * @param {number[][]} matrix - 回転させる行列
     * @returns {number[][]} 回転後の行列
     */
    function rotateMatrix(matrix) {
        // 行と列を入れ替える（転置）
        const transposed = matrix.map((_, i) => matrix.map(row => row[i]));
        // 各行を反転させる
        return transposed.map(row => row.reverse());
    }

    /**
     * プレイヤーのテトリミノを回転させます。
     */
    function playerRotate() {
        const originalMatrix = player.matrix;
        player.matrix = rotateMatrix(player.matrix);

        // TODO: ここにウォールキック（壁際で回転したときに少しずらす）のロジックを追加すると、より操作性が向上します。
        if (collisionCheck(player)) {
            // 衝突した場合は回転を元に戻す
            player.matrix = originalMatrix;
        } else {
            playSound(sfx.rotate);
        }
    }

    /**
     * プレイヤーのテトリミノをホールドします。
     */
    function playerHold() {
        if (!canHold) {
            return; // このピースでは既にホールド済み
        }

        playSound(sfx.hold);
        if (holdPieceType === null) {
            holdPieceType = player.type;
            advancePiece(); // 最初のホールド時は新しいピースを出す
        } else {
            const tempType = player.type;
            resetPlayer(holdPieceType); // ホールドしていたピースでプレイヤーをリセット
            holdPieceType = tempType;   // 現在のピースをホールドに入れる
        }
        canHold = false; // このピースでのホールドを禁止
    }

    /**
     * プレイヤーのテトリミノを一番下まで一気に落とします（ハードドロップ）。
     */
    function playerHardDrop() {
        playSound(sfx.hardDrop);
        // 衝突するまで下に移動
        while (!collisionCheck(player)) {
            player.pos.y++;
        }
        // 衝突したので1つ上に戻す
        player.pos.y--;
        
        lockPiece();
        dropCounter = 0;
    }

    // --- ゲームループ ---
    /**
     * ゲームの状態を更新します。
     * @param {number} time - 現在のタイムスタンプ (requestAnimationFrameから渡される)
     */
    function update(time = 0) {
        const deltaTime = time - lastTime;
        lastTime = time;

        dropCounter += deltaTime;
        if (dropCounter > dropInterval) {
            playerDrop();
        }

        // Update line clear effects
        if (lineClearEffects.length > 0) {
            lineClearEffects = lineClearEffects.filter(effect => {
                effect.alpha -= 0.05; // フェードアウトの速度
                return effect.alpha > 0;
            });
        }

        // Update game effects
        if (gameEffects.length > 0) {
            gameEffects = gameEffects.filter(effect => {
                effect.lifetime--;
                return effect.lifetime > 0;
            });
        }
    }

    function gameLoop(time = 0) {
        update(time);
        draw(); // 画面を描画
        animationFrameId = requestAnimationFrame(gameLoop); // 次のフレームを予約
    }

    /**
     * ゲームループを停止します。
     */
    function stopGame() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    /**
     * ゲームオーバー処理を実行します。
     */
    function handleGameOver() {
        playSound(sfx.gameOver);
        sfx.bgm.pause();
        gameState = GAME_STATE.GAME_OVER;
        stopGame();
        finalScoreElement.innerText = score;
        gameOverScreen.classList.remove('hidden');
    }

    /**
     * ゲームのポーズ/再開を切り替えます。
     */
    function togglePause() {
        if (gameState === GAME_STATE.PLAYING) {
            gameState = GAME_STATE.PAUSED;
            sfx.bgm.pause();
            stopGame();
            pauseScreen.classList.remove('hidden');
        } else if (gameState === GAME_STATE.PAUSED) {
            gameState = GAME_STATE.PLAYING;
            sfx.bgm.play().catch(e => console.error("BGM play failed:", e));
            pauseScreen.classList.add('hidden');
            lastTime = performance.now(); // 時間のジャンプを防ぐ
            gameLoop();
        }
    }

    /**
     * ゲームを開始します。
     */
    function startGame() {
        stopGame(); // 既存のゲームループがあれば停止
        gameOverScreen.classList.add('hidden'); // ゲームオーバー画面を隠す
        board = createEmptyBoard();
        score = 0;
        level = 1;
        scoreElement.innerText = score;
        levelElement.innerText = level;
        dropInterval = 1000; // 落下速度をリセット
        gameState = GAME_STATE.PLAYING;
        holdPieceType = null;
        comboCounter = 0;
        gameEffects = [];

        // 最初のピースと次のピースを準備
        nextPieceType = PIECES[Math.floor(Math.random() * PIECES.length)];
        advancePiece();

        // BGMの再生を開始
        sfx.bgm.pause();
        sfx.bgm.currentTime = 0;
        sfx.bgm.play().catch(e => console.log("BGMの再生にはユーザー操作が必要です。"));

        lastTime = 0;
        dropCounter = 0;
        gameLoop();
    }

    /**
     * ゲームアクションの実行をラップし、ポーズ状態をチェックします。
     * @param {function} action - 実行するアクション
     */
    function handleGameAction(action) {
        if (gameState !== GAME_STATE.PLAYING) {
            return;
        }
        action();
    }

    // --- イベントハンドリング ---
    const keyMap = {
        'ArrowUp': '[data-direction="up"]',
        'ArrowDown': '[data-direction="down"]',
        'ArrowLeft': '[data-direction="left"]',
        'ArrowRight': '[data-direction="right"]',
        '1': '[data-direction="up"]',      // 1キーは上ボタン（回転）と連動
        ' ': '[data-action="b"]',          // SpaceキーはBボタン（ハードドロップ）と連動
        'KeyA': '[data-action="a"]',       // Aボタン (物理キーA)
        'KeyB': '[data-action="b"]',       // Bボタン (物理キーB)
        'KeyG': '[data-action="action"]',  // Gキーは中央ボタン（ホールド）と連動
    };

    // キーが押されたときの処理（ゲーム操作とUIフィードバック）
    window.addEventListener('keydown', (event) => {
        // ゲームオーバー画面が表示されている場合
        if (gameState === GAME_STATE.GAME_OVER) {
            if (event.key === 'Enter') {
                // Enterキーでリトライ
                startGame();
            }
            return;
        }

        const key = event.key.toLowerCase();

        // ポーズ/再開の切り替え
        if (key === 'p') {
            togglePause();
            return;
        }

        // ゲームのリスタート
        if (key === 'r') {
            if (confirm('ゲームをリスタートしますか？ (Restart game?)')) {
                startGame();
            }
            return;
        }

        // ポーズ中はキー操作を無効化 (ポーズ解除とリスタート以外)
        if (gameState === GAME_STATE.PAUSED) {
            return;
        }

        // ゲーム操作
        switch (key) {
            case 'ArrowLeft':
            case 'v':
                handleGameAction(() => playerMove(-1));
                break;
            case 'ArrowRight':
            case 'n':
                handleGameAction(() => playerMove(1));
                break;
            case 'ArrowDown':
            case 'b':
                handleGameAction(userPlayerDrop);
                break;
            case 'a':
            case '1': // 回転
                handleGameAction(playerRotate);
                break;
            case ' ': // ハードダウン
                handleGameAction(playerHardDrop);
                break;
            case 'g': // ホールド
                handleGameAction(playerHold);
                break;
        }

        // UIボタンの見た目を変更
        const selector = keyMap[event.key] || keyMap[event.code]; // event.codeは物理キーに対応
        if (selector) {
            const button = document.querySelector(`.dpad-button${selector}, .action-button${selector}`);
            if (button && !button.classList.contains('active')) {
                button.classList.add('active');
            }
        }
    });

    // キーが離されたときの処理（UIフィードバック）
    window.addEventListener('keyup', (event) => {
        const selector = keyMap[event.key] || keyMap[event.code];
        if (selector) {
            const button = document.querySelector(`.dpad-button${selector}, .action-button${selector}`);
            if (button) {
                button.classList.remove('active');
            }
        }
    });

    // UIボタンのクリックイベント
    document.querySelector('[data-direction="left"]').addEventListener('click', () => handleGameAction(() => playerMove(-1)));
    document.querySelector('[data-direction="right"]').addEventListener('click', () => handleGameAction(() => playerMove(1)));
    document.querySelector('[data-direction="up"]').addEventListener('click', () => handleGameAction(playerRotate));      // 上ボタン
    document.querySelector('[data-direction="down"]').addEventListener('click', () => handleGameAction(userPlayerDrop));
    document.querySelector('[data-action="action"]').addEventListener('click', () => handleGameAction(playerHold)); // 中央ボタン
    document.querySelector('[data-action="a"]').addEventListener('click', () => handleGameAction(playerRotate));      // Aボタン
    document.querySelector('[data-action="b"]').addEventListener('click', () => handleGameAction(playerHardDrop));        // Bボタン

    // リトライボタンのイベント
    retryButton.addEventListener('click', () => {
        startGame();
    });

    // --- ゲーム開始 ---
    startGame();
});
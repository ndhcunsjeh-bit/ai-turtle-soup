'use strict';

/**
 * AI 海龟汤 —— 纯前端离线版逻辑（GitHub Pages 版）。
 *
 * 与原 app.js 的区别：
 *   - 不再 fetch 后端，判定直接调用 window.HostEngine（ghpages.js）。
 *   - 题库来自 window.TURTLES（data.js）。
 *   - 存档用 localStorage，不再依赖服务端 gameId。
 *
 * UI 渲染、弹窗、配色、移动端键盘等逻辑与原版一致。
 */

(function () {
  const STORAGE_KEY = 'turtle-soup-offline-v1';

  const el = {
    app: document.querySelector('.app'),
    chat: document.getElementById('chat'),
    surfaceText: document.getElementById('surfaceText'),
    difficultyBadge: document.getElementById('difficultyBadge'),
    horrorBadge: document.getElementById('horrorBadge'),
    modeChip: document.getElementById('modeChip'),
    hintBtn: document.getElementById('hintBtn'),
    restartBtn: document.getElementById('restartBtn'),
    newBtn: document.getElementById('newBtn'),
    askForm: document.getElementById('askForm'),
    questionInput: document.getElementById('questionInput'),
    sendBtn: document.getElementById('sendBtn'),
    guessBtn: document.getElementById('guessBtn'),
    guessModal: document.getElementById('guessModal'),
    guessInput: document.getElementById('guessInput'),
    guessCancelBtn: document.getElementById('guessCancelBtn'),
    guessSubmitBtn: document.getElementById('guessSubmitBtn'),
    giveUpBtn: document.getElementById('giveUpBtn'),
    revealModal: document.getElementById('revealModal'),
    revealLabel: document.getElementById('revealLabel'),
    revealTitle: document.getElementById('revealTitle'),
    revealText: document.getElementById('revealText'),
    revealRestartBtn: document.getElementById('revealRestartBtn'),
    revealNewBtn: document.getElementById('revealNewBtn'),
  };

  const state = {
    puzzle: null,
    hintIndex: 0,
    messages: [],
    busy: false,
    solved: false,
  };

  const ANSWER_KIND = {
    是: 'k-yes',
    否: 'k-no',
    无关: 'k-irrelevant',
    无法回答: 'k-unknown',
    恭喜猜对: 'k-win',
  };

  const VERDICT_KIND = {
    正确: 'k-correct',
    接近: 'k-close',
    错误: 'k-wrong',
  };

  /* --------------------------------- 渲染 ---------------------------------- */

  function scrollToBottom() {
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function bubbleClass(msg) {
    const kind = msg.role === 'system' ? '' : msg.kind || '';
    return ['bubble', msg.role, kind].filter(Boolean).join(' ');
  }

  function renderMessage(msg) {
    const node = document.createElement('div');
    node.className = bubbleClass(msg);
    node.textContent = msg.text;
    el.chat.appendChild(node);
    return node;
  }

  function renderAll() {
    el.chat.textContent = '';
    state.messages.forEach(renderMessage);
    scrollToBottom();
  }

  function addMessage(role, text, kind) {
    const msg = { role, text, kind: kind || '' };
    state.messages.push(msg);
    renderMessage(msg);
    scrollToBottom();
    persist();
    return msg;
  }

  function updateLastMessage(text, kind) {
    const msg = state.messages[state.messages.length - 1];
    if (!msg) return;
    msg.text = text;
    msg.kind = kind || '';

    const node = el.chat.lastElementChild;
    if (node) {
      node.className = bubbleClass(msg);
      node.textContent = text;
    }
    scrollToBottom();
    persist();
  }

  function dropPendingMessages() {
    state.messages = state.messages.filter((m) => m.kind !== 'k-pending');
  }

  function setBadge(node, label, value) {
    node.textContent = '';
    node.appendChild(document.createTextNode(label + ' '));
    const strong = document.createElement('b');
    strong.textContent = String(value);
    node.appendChild(strong);
    node.appendChild(document.createTextNode('/5'));
  }

  function applyPuzzle() {
    const p = state.puzzle;
    if (!p) return;
    el.surfaceText.textContent = p.surface;
    setBadge(el.difficultyBadge, '难度', p.difficulty);
    setBadge(el.horrorBadge, '恐怖', p.horror);
    el.modeChip.textContent = '离线判定模式';
  }

  function setBusy(busy) {
    state.busy = busy;
    const blocked = busy || state.solved;
    el.sendBtn.disabled = blocked;
    el.guessBtn.disabled = blocked;
    el.hintBtn.disabled = busy;
    el.newBtn.disabled = busy;
    el.restartBtn.disabled = busy;
    el.questionInput.disabled = state.solved;
  }

  /* --------------------------------- 存档 ---------------------------------- */

  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          puzzle: state.puzzle,
          hintIndex: state.hintIndex,
          messages: state.messages,
          solved: state.solved,
        })
      );
    } catch (err) {
      /* 隐私模式下写不进去，忽略即可 */
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.puzzle || !data.puzzle.id) return false;

      state.puzzle = data.puzzle;
      state.hintIndex = data.hintIndex || 0;
      state.solved = Boolean(data.solved);
      state.messages = (Array.isArray(data.messages) ? data.messages : []).filter(
        (m) => m.kind !== 'k-pending'
      );

      if (!state.messages.length) return false;

      applyPuzzle();
      renderAll();
      setBusy(false);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* --------------------------------- 游戏流程 ------------------------------- */

  function pickPuzzle() {
    const all = window.TURTLES || [];
    const current = state.puzzle ? state.puzzle.id : null;
    return HostEngine.pickPuzzle(all, current);
  }

  function startGame() {
    const puzzle = pickPuzzle();
    state.puzzle = puzzle;
    state.hintIndex = 0;
    state.solved = false;
    state.messages = [];

    applyPuzzle();
    renderAll();
    addMessage(
      'system',
      '汤面已经给你了。问我问题吧——我只能回答「是」「否」「无关」「无法回答」。'
    );
    setBusy(false);
  }

  function restartGame() {
    state.hintIndex = 0;
    state.solved = false;
    state.messages = [];

    applyPuzzle();
    renderAll();
    addMessage('system', '已重开。还是这道题，重新来过。');
    setBusy(false);
  }

  function requestHint() {
    if (state.busy) return;
    const hints = state.puzzle.hints || [];
    if (state.hintIndex >= hints.length) {
      addMessage('ai', '没有更多线索了，剩下的靠你自己。', 'k-hint');
      return;
    }
    const hint = hints[state.hintIndex];
    state.hintIndex += 1;
    addMessage('ai', '线索：' + hint, 'k-hint');
  }

  function askQuestion(text) {
    const question = text.trim();
    if (!question || state.busy || state.solved) return;

    addMessage('player', question);
    el.questionInput.value = '';
    addMessage('ai', '…', 'k-pending');

    const answer = HostEngine.localAsk(question, state.puzzle);
    updateLastMessage(answer, ANSWER_KIND[answer] || '');

    if (answer === '恭喜猜对') {
      state.solved = true;
      addMessage('system', '真相已经被你说出来了。');
      window.setTimeout(() => showReveal(state.puzzle.bottom, '恭喜猜对'), 550);
      setBusy(false);
    }
  }

  function submitGuess() {
    const guess = el.guessInput.value.trim();
    if (!guess || state.busy) return;

    closeModal(el.guessModal);
    el.guessInput.value = '';

    addMessage('player', '【我的猜测】' + guess);
    addMessage('ai', '…', 'k-pending');

    const verdict = HostEngine.localGuess(guess, state.puzzle);
    updateLastMessage(verdict, VERDICT_KIND[verdict] || '');

    if (verdict === '正确') {
      state.solved = true;
      addMessage('system', '猜对了。');
      window.setTimeout(() => showReveal(state.puzzle.bottom, '恭喜猜对'), 550);
      setBusy(false);
    }
  }

  function giveUp() {
    closeModal(el.guessModal);
    state.solved = true;
    addMessage('system', '你选择了放弃，汤底如下。');
    showReveal(state.puzzle.bottom, '汤底');
    setBusy(false);
  }

  /* --------------------------------- 弹窗 ---------------------------------- */

  function openModal(modal) {
    modal.hidden = false;
  }

  function closeModal(modal) {
    modal.hidden = true;
  }

  function showReveal(bottom, label) {
    el.revealLabel.textContent = label || '汤底';
    el.revealTitle.textContent = state.puzzle ? state.puzzle.title : '';
    el.revealText.textContent = bottom || '';
    openModal(el.revealModal);
    persist();
  }

  /* -------------------------------- 事件绑定 -------------------------------- */

  function bindEvents() {
    el.askForm.addEventListener('submit', function (event) {
      event.preventDefault();
      askQuestion(el.questionInput.value);
    });

    el.guessBtn.addEventListener('click', function () {
      if (state.busy || state.solved) return;
      openModal(el.guessModal);
      window.setTimeout(() => el.guessInput.focus(), 80);
    });

    el.guessCancelBtn.addEventListener('click', function () {
      closeModal(el.guessModal);
    });

    el.guessSubmitBtn.addEventListener('click', submitGuess);
    el.giveUpBtn.addEventListener('click', giveUp);
    el.hintBtn.addEventListener('click', requestHint);
    el.restartBtn.addEventListener('click', restartGame);

    el.newBtn.addEventListener('click', function () {
      startGame();
    });

    el.revealRestartBtn.addEventListener('click', function () {
      closeModal(el.revealModal);
      restartGame();
    });

    el.revealNewBtn.addEventListener('click', function () {
      closeModal(el.revealModal);
      startGame();
    });

    el.guessModal.addEventListener('click', function (event) {
      if (event.target === el.guessModal) closeModal(el.guessModal);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !el.guessModal.hidden) closeModal(el.guessModal);
    });
  }

  /* ------------------------------- 移动端键盘 ------------------------------- */

  function setupViewport() {
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = function () {
      const keyboardOpen = vv.height < window.innerHeight - 80;
      if (keyboardOpen) {
        document.documentElement.style.setProperty('--vvh', vv.height + 'px');
        scrollToBottom();
      } else {
        document.documentElement.style.removeProperty('--vvh');
      }
    };

    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
  }

  /* --------------------------------- 启动 ---------------------------------- */

  function init() {
    bindEvents();
    setupViewport();
    if (!restore()) startGame();
  }

  init();
})();

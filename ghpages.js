'use strict';

/**
 * AI 海龟汤 —— 纯前端离线判定引擎（GitHub Pages 版）。
 *
 * 这是 server/host.js 里「本地判定」逻辑的浏览器平移版，删掉了 fs / fetch / LLM。
 * 判定规则与 host.js 保持一致（受控词白名单、四类「无法回答」、关键词匹配、
 * 相似度、core 命中）。若要改判定规则，请同步修改 server/host.js，避免两处漂移。
 *
 * 暴露一个全局对象 window.HostEngine，供 offline/app.js 使用。
 */

(function (global) {
  'use strict';

  const ANSWER_WHITELIST = ['是', '否', '无关', '无法回答', '恭喜猜对'];
  const VERDICT_WHITELIST = ['正确', '接近', '错误'];
  const FALLBACK_ANSWER = '无法回答';
  const FALLBACK_VERDICT = '错误';
  const MAX_INPUT_LENGTH = 300;

  /* ------------------------------ 输出归一化 ------------------------------ */

  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_INPUT_LENGTH);
  }

  function stripPunct(text) {
    return String(text == null ? '' : text).replace(
      /[\s，。,.!！?？、；;：:""''「」『』（）()[\]【】<>《》~～\-—_*#`|/\\]/g,
      ''
    );
  }

  function normalizeAnswer(raw) {
    const text = stripPunct(raw);
    if (!text) return FALLBACK_ANSWER;
    if (ANSWER_WHITELIST.includes(text)) return text;

    if (/恭喜|猜对|答对/.test(text)) return '恭喜猜对';
    if (/无法回答|不能回答|无可奉告/.test(text)) return '无法回答';
    if (/无关|不相干|没有关系/.test(text)) return '无关';
    if (/不是|不对|不正确|没有|否/.test(text)) return '否';
    if (/是|对/.test(text) && text.length <= 8) return '是';
    if (/yes/i.test(text)) return '是';
    if (/no/i.test(text)) return '否';

    return FALLBACK_ANSWER;
  }

  function normalizeVerdict(raw) {
    const text = stripPunct(raw);
    if (!text) return FALLBACK_VERDICT;
    if (VERDICT_WHITELIST.includes(text)) return text;

    if (/不正确|不完全正确|不对|错误|不符|方向错|完全错/.test(text)) return '错误';
    if (/接近|部分正确|部分对|差不多|大体|沾边|八九不离十/.test(text)) return '接近';
    if (/正确|答对|猜对/.test(text)) return '正确';

    return FALLBACK_VERDICT;
  }

  /* ------------------------------ 本地判定逻辑 ----------------------------- */

  // 「无法回答」四类之一：直接要答案/提示、让扮演角色、要求忽略或复述规则
  const META_PATTERNS = [
    /汤底/,
    /答案是什么|告诉我答案|正确答案|直接说答案|公布答案|说出答案|答案就是/,
    /告诉我真相|真相是什么/,
    /给我?(一个|个)?(提示|线索)|(提示|线索)是(什么|啥)|给点(提示|线索)|再来个?(提示|线索)|求(个)?(提示|线索)/,
    /忽略.{0,8}(规则|指令|设定|提示)/,
    /(扮演|假装|现在你是|你现在是|你现在的身份|你的新身份|你是我的助手)/,
    /(系统|system).{0,6}(提示|指令|消息|prompt)/i,
    /prompt/i,
    /开发者模式|管理员模式|越狱|jailbreak/i,
    /(输出|复述|重复).{0,6}(规则|设定|指令|提示词)/,
  ];

  // 之二：问题太模糊、指向不明
  const VAGUE_PATTERNS = [
    /有鬼|闹鬼|鬼魂?作怪|灵异|超自然|玄学|诅咒|邪门|运气|命运|是不是有什么/,
  ];

  // 之三：问主观感受
  const SUBJECTIVE_PATTERNS = [
    /痛苦|难过|伤心|害怕|吓人|恐惧|绝望|崩溃|内疚|愧疚|后悔|开心|高兴|幸福|可怜|难受|舍不得|不甘|残忍|变态|可不可怕|恐不恐怖/,
  ];

  function isCompoundQuestion(text) {
    const marks = text.match(/是不是|有没有|对吗|吗/g);
    if (marks && marks.length >= 2) return true;
    if (/又.{1,12}又|并且|而且|同时|之后又|然后还|还要/.test(text)) return true;
    return false;
  }

  const OFF_TOPIC_PATTERNS = [
    /天气/,
    /吃(什么|饭|过了吗)/,
    /你是谁/,
    /几点|几号|星期几/,
    /聊天|无聊/,
    /讲个笑话|唱首歌|讲个故事/,
  ];

  function isMeta(text) {
    return META_PATTERNS.some((re) => re.test(text));
  }

  function isVague(text) {
    return VAGUE_PATTERNS.some((re) => re.test(text));
  }

  function isSubjective(text) {
    return SUBJECTIVE_PATTERNS.some((re) => re.test(text));
  }

  function isOffTopic(text) {
    return OFF_TOPIC_PATTERNS.some((re) => re.test(text));
  }

  function matchKeys(text, list) {
    if (!Array.isArray(list)) return [];
    return list.filter((k) => k && text.includes(k));
  }

  function coreHits(text, puzzle) {
    return matchKeys(text, puzzle.core);
  }

  function bigrams(text) {
    const s = String(text).replace(/\s+/g, '');
    const grams = new Set();
    for (let i = 0; i + 2 <= s.length; i += 1) grams.add(s.slice(i, i + 2));
    return grams;
  }

  function similarity(a, b) {
    const A = bigrams(a);
    const B = bigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const gram of A) {
      if (B.has(gram)) inter += 1;
    }
    return (2 * inter) / (A.size + B.size);
  }

  function isSolvedByText(text, puzzle) {
    const hits = coreHits(text, puzzle).length;
    const total = (puzzle.core || []).length || 1;
    if (hits >= 3 || (hits >= 2 && hits * 5 >= total * 3)) return true;
    return similarity(text, puzzle.bottom) >= 0.45;
  }

  function localAsk(question, puzzle) {
    const q = clean(question);
    if (!q) return FALLBACK_ANSWER;

    if (isSolvedByText(q, puzzle)) return '恭喜猜对';

    if (isMeta(q)) return '无法回答';
    if (isVague(q)) return '无法回答';
    if (isSubjective(q)) return '无法回答';
    if (isCompoundQuestion(q)) return '无法回答';

    if (isOffTopic(q)) return '无关';

    const yes = matchKeys(q, puzzle.keywords && puzzle.keywords.yes);
    const no = matchKeys(q, puzzle.keywords && puzzle.keywords.no);

    if (yes.length && !no.length) return '是';
    if (no.length && !yes.length) return '否';
    if (yes.length && no.length) {
      const longYes = Math.max(...yes.map((k) => k.length));
      const longNo = Math.max(...no.map((k) => k.length));
      if (longYes > longNo) return '是';
      if (longNo > longYes) return '否';
    }
    return '无法回答';
  }

  function localGuess(guessText, puzzle) {
    const g = clean(guessText);
    if (!g) return FALLBACK_VERDICT;

    const hits = coreHits(g, puzzle).length;
    const total = (puzzle.core || []).length || 1;
    const sim = similarity(g, puzzle.bottom);

    if (hits >= 3 || (hits >= 2 && hits * 5 >= total * 3) || sim >= 0.45) return '正确';
    if (hits >= 1 || sim >= 0.18) return '接近';
    return '错误';
  }

  /* -------------------------------- 题库与选择 ------------------------------- */

  function pickPuzzle(all, excludeId) {
    const pool = all.filter((p) => p.id !== excludeId);
    const source = pool.length ? pool : all;
    return source[Math.floor(Math.random() * source.length)];
  }

  global.HostEngine = {
    clean,
    normalizeAnswer,
    normalizeVerdict,
    localAsk,
    localGuess,
    pickPuzzle,
    isSolvedByText,
    similarity,
    // 内部函数暴露出来，方便离线版自测
    _internal: {
      isMeta,
      isVague,
      isSubjective,
      isCompoundQuestion,
      isOffTopic,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);

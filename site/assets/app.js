/* abap-cli project site — interactions, i18n, data rendering. */
(() => {
  'use strict';

  const DATA = Array.isArray(window.ABAP_OBJECTS) ? window.ABAP_OBJECTS : [];
  const CATEGORIES = Array.isArray(window.ABAP_CATEGORIES) ? window.ABAP_CATEGORIES : [];
  const STATS = window.ABAP_STATS || { total: DATA.length, create: 0, pull: 0, push: 0, delete: 0, readOnly: 0 };
  const shotMode = new URLSearchParams(window.location.search).get('shot') === '1';
  const reduceMotion = shotMode || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  /* ---------------------------------------------------------------- i18n */
  const ZH = {
    'meta.title': 'abap-cli — 为 ABAP 而生的 Vibe coding',
    'meta.description': '把 SAP 对象拉到编辑器里，改完推回 SAP；锁、激活和传输都已处理好。50+ 对象类型、JSON 优先、为 agent 设计。',
    'nav.loop': '工作流',
    'nav.features': '能力',
    'nav.types': '对象类型',
    'nav.commands': '命令',
    'nav.architecture': '架构',
    'nav.docs': '文档',
    'nav.skip': '跳到主要内容',
    'hero.eyebrow': '开源 ABAP 开发工具',
    'hero.lede': '把 SAP 对象拉到编辑器里，让 agent 跑完整条循环。<strong>abap-cli</strong> 处理加锁、激活和传输，你在文件里工作——而不是在 SE80。',
    'hero.cta1': '60 秒上手',
    'hero.cta2': '在 GitHub 加星',
    'common.copy': '复制',
    'hero.fact1': '种对象类型',
    'hero.fact2': '个命令',
    'hero.fact3': '个 agent skills',
    'hero.fact4': '套 JSON 契约',
    'terminal.connected': '已连接',
    'terminal.auto': '自动播放',
    'terminal.types': '种对象类型',
    'terminal.channels': '两条通道',
    'stats.types': '对象类型',
    'stats.commands': 'CLI 命令',
    'stats.skills': 'Agent skills',
    'stats.channels': 'SAP 通道 · ADT + ICF',
    'loop.eyebrow': '工作流',
    'loop.title': '你的编辑器，<br>就是新的 <span class="mark">SE80</span>。',
    'loop.lede': '以前改一行 ABAP 要逛一圈 GUI：找对象、加锁、编辑、激活、解锁、找传输请求。abap-cli 把它压缩成一次文件编辑和一次 push。',
    'loop.before': '没有 abap-cli',
    'loop.beforeTitle': '一次修改，七次上下文切换。',
    'loop.beforeStep1': '启动 SAP GUI',
    'loop.beforeStep2': '打开 SE80 / SE11',
    'loop.beforeStep3': '找到并锁定对象',
    'loop.beforeStep4': '在 ABAP 编辑器里修改',
    'loop.beforeStep5': '保存、检查、激活',
    'loop.beforeStep6': '解锁并分配传输请求',
    'loop.beforeStep7': '下一个对象，再来一遍',
    'loop.beforeFoot': '每一步都是一次上下文切换。',
    'loop.after': '使用 abap-cli',
    'loop.afterTitle': '一个文件，一次 push。',
    'loop.afterComment': '用任意编辑器修改',
    'loop.afterFoot': '加锁、激活和传输请求都已处理。',
    'loop.metricCommands': '命令',
    'loop.metricGui': 'GUI 界面',
    'loop.metricTransport': '传输请求',
    'loop.pipelineEyebrow': '六步循环',
    'loop.pipelineNote': '每条命令都说 JSON，所以同一套循环既给人用，也给 agent 用。',
    'loop.step1': '拉取',
    'loop.step1Desc': '对象 → 扁平 AFF 文件，落在 src/。',
    'loop.step2': '编辑',
    'loop.step2Desc': '任意编辑器、任意 agent、正常 diff。',
    'loop.step3': '检查',
    'loop.step3Desc': '写入前做语法、ATC 和本地内容检查。',
    'loop.step4': '推送',
    'loop.step4Desc': '一次完成加锁、写入、激活、解锁。',
    'loop.step5': '运行',
    'loop.step5Desc': 'classrun 或 PUBLIC STATIC 方法。',
    'loop.step6': '验证',
    'loop.step6Desc': 'ABAP Unit 结果、退出码、JSON。',
    'features.eyebrow': '引擎盖下面',
    'features.title': '命令面很小，<br>管线很完整。',
    'features.lede': '那些本来要围绕 ADT API 自己搭的东西：传输请求、激活、本地文件格式、schema，以及给 agent 的稳定契约。',
    'features.card1Title': '契约天生面向 agent',
    'features.card1Desc': '每条命令都说 <code>--json</code>；每个顶层命令都发布 <code>--schema</code>。稳定的退出码和错误类别让 agent 不用解析散文，也能正确恢复。',
    'features.card2Title': '文件，而不是 GUI 会话',
    'features.card2Desc': 'AFF 扁平布局：每个对象的一组产物直接放在 <code>src/</code>。命名空间对象用括号 token，<code>/UI2/CL_JSON</code> 变成 <code>(ui2)cl_json.clas.abap</code>。',
    'features.card3Title': '两条通道，一个 CLI',
    'features.card3Desc': '源对象走 ADT REST；DDIC、SICF、表数据和运行时读取走内置 ICF 服务，补上 ADT 没有的端点。',
    'features.card4Title': '传输请求内置',
    'features.card4Desc': '创建、列出、解析、分配传输请求。push 按对象解析；已经知道请求号时直接传 <code>--tr</code>。',
    'features.card5Title': '默认安全',
    'features.card5Desc': '只读命令保持只读。东西到 SAP 之前，<code>--dry-run</code>、<code>--check-only</code> 和 <code>--atomic</code> 已经就位。',
    'features.card6Title': 'Agent 上下文，随包分发',
    'features.card6Desc': 'npm 包自带 6 个渐进披露 skills 和 <code>abap-developer</code> agent 定义。可安装到 Claude、Copilot、Cursor 或中立的 <code>agents/</code> 布局。',
    'agent.eyebrow': '为 agent 设计',
    'agent.title': 'CLI 是工具。<br>Agent 负责驱动。',
    'agent.lede': 'agent 从二进制本身发现命令面，用 <code>--json</code> 跑循环；SAP 拒绝时拿到的是可操作的错误码。不用爬文档，不用猜参数。',
    'agent.bullet1': '<strong>自描述。</strong> <code>abap &lt;cmd&gt; --schema --json</code> 返回参数、选项、允许值、示例和错误。',
    'agent.bullet2': '<strong>稳定退出码。</strong> 0–9 与错误类别一一对应，重试和升级路径是确定的。',
    'agent.bullet3': '<strong>渐进上下文。</strong> 6 个 skills 先按名称和描述加载，只有任务需要时才读正文。',
    'agent.exitLabel': '退出码',
    'types.eyebrow': '覆盖范围',
    'types.title': '<span data-stat="total">51</span> 种对象类型。一个扁平 <span class="mark">src/</span>。',
    'types.lede': '源对象、DDIC、CDS、RAP、服务、安全和 AFF 基础对象。按类别、通道或能力筛选，看清哪些走 ADT、哪些需要内置 ICF 服务。',
    'types.channelAll': '全部',
    'types.channelAuto': '自动',
    'types.capability': '能力',
    'types.capAll': '全部能力',
    'types.capCreate': '可创建',
    'types.capPush': '可推送',
    'types.capDelete': '可删除',
    'types.capReadonly': '只读拉取',
    'types.legendYes': '直接支持',
    'types.legendFile': '需要 --file',
    'types.legendTmp': '仅本地包',
    'types.colType': '类型',
    'types.colObject': '对象',
    'types.colCreate': '创建',
    'types.colPull': '拉取',
    'types.colPush': '推送',
    'types.colDelete': '删除',
    'types.colChannel': '通道',
    'types.colArtifacts': '本地产物',
    'types.empty': '没有匹配的对象类型。',
    'types.reset': '重置筛选',
    'types.foot': '<strong>49</strong> 种可创建 · <strong>47</strong> 种可写 · <strong>2</strong> 种只读。矩阵由 <code>docs/supported.md</code> 生成。',
    'types.full': '完整类型参考',
    'commands.eyebrow': '命令面',
    'commands.title': '32 个命令。<br>每一个都说 <span class="mark">JSON</span>。',
    'commands.lede': '按你要做的事分组，而不是按 SAP 事务码。每个顶层命令也支持 <code>--schema --json</code>。',
    'commands.full': '完整命令参考',
    'arch.eyebrow': '架构',
    'arch.title': '三层。两条通道。',
    'arch.lede': '一个轻量 TypeScript CLI、一个内置 ABAP 服务，加上 agent markdown。没有别的要托管，也没有中间件横在编辑器和 SAP 之间。',
    'arch.agent': 'Agent',
    'arch.editor': '你的编辑器',
    'arch.adt': 'SAP ADT REST',
    'arch.adtDesc': '源对象、搜索、加锁、检查和激活。',
    'arch.icf': '内置 ABAP 服务',
    'arch.icfDesc': 'DDIC、SICF、表数据、报表、MIME 和运行时读取。',
    'arch.sap': '你的 SAP 系统',
    'start.eyebrow': '快速开始',
    'start.title': '从零到第一次 push。',
    'start.lede': '需要 Node 24.22.1+、开启 ADT 的 SAP 系统，以及有开发权限的用户。密码写入 OS keychain，不落项目文件。',
    'start.reqTitle': '开始之前',
    'start.req1': 'Node.js 24.22.1 或更新',
    'start.req2': '已开启 ADT 的 SAP 系统',
    'start.req3': '创建 / 修改 / 激活权限',
    'start.guide': '阅读安装指南',
    'start.step1Title': '安装 CLI',
    'start.step1Desc': '一个全局包。唯一运行时要求是 Node 24。',
    'start.step2Title': '连接 profile',
    'start.step2Desc': '密码存入 OS keychain；TLS 信任按 profile 管理，可用 <code>--ca</code> 导入 CA。',
    'start.step3Title': '部署内置服务',
    'start.step3Desc': '源对象只靠 ADT 就能用；DDIC、数据和运行时命令需要 ICF 服务。',
    'start.step4Title': '跑第一轮循环',
    'start.step4Desc': '拉取对象、改文件、推回去。没有打开的传输请求？用 <code>abap transport create</code> 现建一个。',
    'cta.eyebrow': '准备好了就开始',
    'cta.title': '像写代码一样交付 ABAP。',
    'cta.lede': '装一次，指向你的系统，让循环跑起来。',
    'cta.copy': '复制安装命令',
    'cta.docs': '浏览文档',
    'footer.tagline': '为 ABAP 而生的 vibe coding。拉取、编辑、推送、运行——在终端里，或者交给 agent。',
    'footer.node': 'Node 24+',
    'footer.product': '产品',
    'footer.releases': '版本',
    'footer.reference': '参考',
    'footer.gettingStarted': '快速开始',
    'footer.commands': '命令',
    'footer.types': '对象类型',
    'footer.architecture': '架构',
    'footer.community': '社区',
    'footer.issues': 'Issues',
    'footer.contributing': '参与贡献',
    'footer.security': '安全',
    'footer.license': '许可证',
    'footer.notAffiliated': '与 SAP SE 无隶属关系。SAP 和 ABAP 是 SAP SE 的商标。',
    'footer.top': '回到顶部',
  };

  const UI = {
    en: {
      categories: { source: 'Source code', cds: 'CDS & RAP', ddic: 'DDIC', services: 'Services & UI', jobs: 'ATC & jobs', security: 'Security', aff: 'AFF basis' },
      all: 'All',
      matrixCount: (shown, total) => `${shown} of ${total} types`,
      searchPlaceholder: 'Search types…',
      yes: 'Supported',
      no: 'Not supported',
      file: 'Requires --file',
      rf: 'RF applications only',
      tmp: 'Local packages only',
      caps: { create: 'Create', pull: 'Pull', push: 'Push', delete: 'Delete' },
      copied: 'Copied to clipboard',
      copyFailed: 'Copy failed — select the text manually',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
      groups: {
        setup: { label: 'Setup & connect', hint: 'Profiles, diagnostics and the bundled service.' },
        source: { label: 'Source workflow', hint: 'Pull, edit, check, push, create and delete.' },
        explore: { label: 'Read & explore', hint: 'Search, metadata, table data, dumps and impact.' },
        run: { label: 'Run & verify', hint: 'Execute classes and reports, run ABAP Unit.' },
        ship: { label: 'Ship & operate', hint: 'Transports, publishing, MIME and AFF validation.' },
      },
    },
    zh: {
      categories: { source: '源代码', cds: 'CDS 与 RAP', ddic: 'DDIC', services: '服务与 UI', jobs: 'ATC 与作业', security: '安全', aff: 'AFF 基础' },
      all: '全部',
      matrixCount: (shown, total) => `${shown} / ${total} 种类型`,
      searchPlaceholder: '搜索类型…',
      yes: '支持',
      no: '不支持',
      file: '需要 --file',
      rf: '仅 RF 应用',
      tmp: '仅本地包',
      caps: { create: '创建', pull: '拉取', push: '推送', delete: '删除' },
      copied: '已复制到剪贴板',
      copyFailed: '复制失败，请手动选择文本',
      openMenu: '打开菜单',
      closeMenu: '关闭菜单',
      groups: {
        setup: { label: '安装与连接', hint: 'Profile、诊断和内置服务。' },
        source: { label: '源码工作流', hint: '拉取、编辑、检查、推送、创建与删除。' },
        explore: { label: '只读探索', hint: '搜索、元数据、表数据、dump 和影响面。' },
        run: { label: '运行与验证', hint: '执行类、报表和 ABAP Unit。' },
        ship: { label: '交付与运维', hint: '传输请求、发布、MIME 和 AFF 校验。' },
      },
    },
  };

  const COMMANDS = [
    { group: 'setup', name: 'init', en: 'Bind this workspace to a profile, set defaults and install agent context.', zh: '把当前工作区绑定到 profile，设置默认值并安装 agent 上下文。' },
    { group: 'setup', name: 'profile', en: 'Add, test, export and import profiles; passwords stay in the OS keychain.', zh: '新增、测试、导出和导入 profile；密码保存在 OS keychain。' },
    { group: 'setup', name: 'doctor', en: 'Diagnose environment and configuration offline; --fix applies safe fixes.', zh: '离线诊断环境与配置；--fix 应用安全修复。' },
    { group: 'setup', name: 'session', en: 'Inspect the cookie jar for the active profile.', zh: '查看当前 profile 的会话 cookie。' },
    { group: 'setup', name: 'deploy', en: 'Install or inspect the bundled ICF service; --dev installs the development tree.', zh: '安装或检查内置 ICF 服务；--dev 安装开发形态。' },
    { group: 'setup', name: 'whoami', en: 'Ask SAP who you really are — user, system, client and release.', zh: '由 SAP 返回真实登录身份：用户、系统、客户端与版本。' },
    { group: 'source', name: 'pull', en: 'Download an object, package or transport into flat AFF files.', zh: '把对象、包或传输请求下载为扁平 AFF 文件。' },
    { group: 'source', name: 'push', en: 'Lock, write, activate and unlock; resolves the transport per object.', zh: '加锁、写入、激活、解锁；按对象解析传输请求。' },
    { group: 'source', name: 'check', en: 'Syntax, local content or ATC before you write.', zh: '写入前做语法、本地内容或 ATC 检查。' },
    { group: 'source', name: 'diff', en: 'Read-only local ↔ SAP comparison.', zh: '只读比较本地与 SAP。' },
    { group: 'source', name: 'status', en: 'See which local objects differ from SAP.', zh: '查看哪些本地对象与 SAP 不一致。' },
    { group: 'source', name: 'create', en: 'Create and activate source or data-driven objects; local drafts off SAP.', zh: '创建并激活源对象或数据驱动对象；可离线生成本地草稿。' },
    { group: 'source', name: 'activate', en: 'Repair stale activation for an object.', zh: '修复对象遗留的未激活项。' },
    { group: 'source', name: 'delete', en: 'Lock, delete and unlock with the usual transport rules.', zh: '加锁、删除、解锁，沿用传输规则。' },
    { group: 'explore', name: 'search', en: 'Search objects by name pattern, package, exact match or fuzzy.', zh: '按名称模式、包、精确或模糊匹配搜索对象。' },
    { group: 'explore', name: 'inspect', en: 'Read metadata, structure, includes, locks and activation state.', zh: '读取元数据、结构、包含、锁和激活状态。' },
    { group: 'explore', name: 'where-used', en: 'Direct references for impact analysis.', zh: '查询直接引用，用于影响面分析。' },
    { group: 'explore', name: 'list', en: 'List the objects in a package.', zh: '列出某个包里的对象。' },
    { group: 'explore', name: 'tcode', en: 'Resolve a transaction code to its entry program and screen.', zh: '把事务码解析成入口程序和屏幕。' },
    { group: 'explore', name: 'dumps', en: 'List recent ST22 runtime dumps.', zh: '列出最近的 ST22 运行时 dump。' },
    { group: 'explore', name: 'select', en: 'Read-only table query — the SE16N equivalent.', zh: '只读表查询，等价于 SE16N。' },
    { group: 'explore', name: 'fields', en: 'List table or view fields, or reverse-look-up a field name.', zh: '列出表 / 视图字段，或按字段名反查。' },
    { group: 'explore', name: 'types', en: 'Print the CLI type ↔ TADIR / DDIC mapping, offline.', zh: '离线打印 CLI 类型 ↔ TADIR / DDIC 映射。' },
    { group: 'run', name: 'run', en: 'Execute a class via classrun or a public static method.', zh: '通过 classrun 或 PUBLIC STATIC 方法执行类。' },
    { group: 'run', name: 'run-report', en: 'Run an activated report and return its list output.', zh: '运行已激活报表并返回列表输出。' },
    { group: 'run', name: 'test', en: 'Run ABAP Unit tests and report failures.', zh: '运行 ABAP Unit 测试并汇报失败项。' },
    { group: 'ship', name: 'transport', en: 'List, create, show, resolve and assign transport requests.', zh: '列出、创建、查看、解析和分配传输请求。' },
    { group: 'ship', name: 'publish', en: 'Publish the local OData endpoint of a service binding.', zh: '发布 service binding 的本地 OData 端点。' },
    { group: 'ship', name: 'unpublish', en: 'Unpublish that OData endpoint.', zh: '取消发布该 OData 端点。' },
    { group: 'ship', name: 'mime', en: 'Create, delete or push MIME repository folders and files.', zh: '创建、删除或推送 MIME 仓库目录与文件。' },
    { group: 'ship', name: 'validate:aff', en: 'Validate AFF JSON against the official vendored schemas.', zh: '用官方 vendored schema 校验 AFF JSON。' },
    { group: 'ship', name: 'report-stuck', en: 'Record a stuck-agent report locally for triage.', zh: '本地记录 agent 卡住报告，供后续排查。' },
  ];

  let lang = 'en';
  const originals = new Map();

  function captureOriginals() {
    $$('[data-i18n], [data-i18n-html]').forEach((el) => {
      const html = el.hasAttribute('data-i18n-html');
      const key = el.getAttribute(html ? 'data-i18n-html' : 'data-i18n');
      originals.set(el, { key, html, en: html ? el.innerHTML : el.textContent });
    });
  }

  function readStoredLang() {
    try {
      const stored = localStorage.getItem('abap-site-lang');
      if (stored === 'zh' || stored === 'en') return stored;
    } catch { /* storage may be unavailable */ }
    return navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  function t(key) {
    return lang === 'zh' ? (ZH[key] ?? null) : null;
  }

  function applyLanguage(next) {
    lang = next;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    originals.forEach((record, el) => {
      const translated = lang === 'zh' ? ZH[record.key] : null;
      if (translated != null) {
        if (record.html) el.innerHTML = translated;
        else el.textContent = translated;
      } else if (record.html) {
        el.innerHTML = record.en;
      } else {
        el.textContent = record.en;
      }
    });

    const metaTitle = lang === 'zh' ? ZH['meta.title'] : 'abap-cli — Vibe coding for ABAP';
    const metaDescription = lang === 'zh' ? ZH['meta.description'] : 'Pull SAP objects into your editor, edit them anywhere, and push back with locks, activation and transports handled. 50+ object types, JSON-first, agent-ready.';
    document.title = metaTitle;
    const description = $('meta[name="description"]');
    if (description) description.setAttribute('content', metaDescription);

    const label = $('#lang-label');
    if (label) label.textContent = lang === 'zh' ? 'EN' : '中文';
    const toggle = $('#lang-toggle');
    if (toggle) toggle.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : 'Switch to Chinese');
    const menu = $('#menu-btn');
    if (menu) menu.setAttribute('aria-label', menu.getAttribute('aria-expanded') === 'true' ? UI[lang].closeMenu : UI[lang].openMenu);

    const search = $('#type-search');
    if (search) search.placeholder = UI[lang].searchPlaceholder;

    updateStatValues();
    renderCategories();
    renderMatrix();
    renderCommands();
    try { localStorage.setItem('abap-site-lang', lang); } catch { /* ignore */ }
  }

  /* ---------------------------------------------------------------- stats */
  function updateStatValues() {
    $$('[data-stat="total"]').forEach((el) => { el.textContent = String(STATS.total); });
    $$('[data-count]').forEach((el) => { el.textContent = el.dataset.count; });
  }

  function animateCount(el) {
    const target = Number(el.dataset.count || 0);
    if (!Number.isFinite(target) || target <= 0) { el.textContent = String(target); return; }
    if (reduceMotion) { el.textContent = String(target); return; }
    const duration = 1100;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = String(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = String(target);
    };
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------------- marquee */
  function renderMarquee() {
    const track = $('#type-marquee');
    if (!track || DATA.length === 0) return;
    const items = DATA.map((row, index) => `<span class="mq-item${index % 7 === 0 ? ' accent' : ''}">${esc(row.code)}</span>`).join('');
    track.innerHTML = items + items;
  }

  /* ---------------------------------------------------------------- terminal */
  const SCENES = {
    cli: [
      { type: 'prompt', text: 'abap pull ZCL_MY_CLASS --textpool' },
      { type: 'ok', text: '✓ 4 files → src/  ·  ADT  ·  38ms' },
      { type: 'prompt', text: 'abap check syntax --changed' },
      { type: 'ok', text: '✓ 0 errors, 0 warnings' },
      { type: 'prompt', text: 'abap push src/zcl_my_class.clas.abap --tr DEVK900001' },
      { type: 'ok', text: '✓ locked → written → activated → unlocked' },
      { type: 'prompt', text: 'abap test ZCL_MY_CLASS --json' },
      { type: 'ok', text: '✓ 12 tests passed  ·  exit 0' },
    ],
    agent: [
      { type: 'agent', text: '▌ agent  Refactor ZCL_MY_CLASS to use CL_JSON' },
      { type: 'prompt', text: 'abap pull ZCL_MY_CLASS --json' },
      { type: 'json', text: '← { "status": "success", "files": 4 }' },
      { type: 'dim', text: '→ edit src/zcl_my_class.clas.abap' },
      { type: 'prompt', text: 'abap check syntax --changed --json' },
      { type: 'json', text: '← { "errors": 0, "warnings": 0 }' },
      { type: 'prompt', text: 'abap push src/zcl_my_class.clas.abap --tr DEVK900001 --json' },
      { type: 'ok', text: '✓ activated  ·  DEVK900001  ·  exit 0' },
    ],
  };

  let activeScene = 'cli';
  let terminalRun = 0;
  let terminalVisible = true;

  function terminalLine(type, text) {
    const line = document.createElement('div');
    line.className = `t-line t-${type}`;
    if (type === 'prompt') {
      const prompt = document.createElement('span');
      prompt.className = 't-prompt';
      prompt.textContent = '$ ';
      const command = document.createElement('span');
      command.className = 't-cmd';
      line.append(prompt, command);
      return { line, textNode: command };
    }
    const span = document.createElement('span');
    line.append(span);
    return { line, textNode: span };
  }

  async function playTerminal(sceneName) {
    const body = $('#terminal-body');
    if (!body) return;
    const run = ++terminalRun;
    const lines = SCENES[sceneName] || SCENES.cli;
    body.innerHTML = '';

    for (const item of lines) {
      if (run !== terminalRun) return;
      const { line, textNode } = terminalLine(item.type, item.text);
      body.append(line);

      if (reduceMotion) {
        textNode.textContent = item.text;
        continue;
      }

      const cursor = document.createElement('span');
      cursor.className = 't-cursor';
      line.append(cursor);
      for (const char of item.text) {
        if (run !== terminalRun) return;
        textNode.textContent += char;
        await wait(item.type === 'prompt' ? 13 : 4);
      }
      cursor.remove();
      await wait(item.type === 'prompt' ? 140 : 240);
    }

    if (reduceMotion || run !== terminalRun) return;
    await wait(5200);
    if (run === terminalRun && terminalVisible) playTerminal(activeScene);
  }

  function setTerminalTab(name) {
    activeScene = name;
    $$('.term-tab').forEach((tab) => {
      const active = tab.dataset.term === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    playTerminal(name);
  }

  /* ---------------------------------------------------------------- i18n renderers */
  function categoryLabel(id) {
    return UI[lang].categories[id] || id;
  }

  function renderCategories() {
    const host = $('#category-filter');
    if (!host) return;
    const buttons = [`<button type="button" class="${matrixState.category === 'all' ? 'active' : ''}" data-category="all">${UI[lang].all}</button>`];
    for (const category of CATEGORIES) {
      const active = matrixState.category === category.id ? ' active' : '';
      buttons.push(`<button type="button" class="${active.trim()}" data-category="${esc(category.id)}">${esc(categoryLabel(category.id))}</button>`);
    }
    host.innerHTML = buttons.join('');
  }

  /* ---------------------------------------------------------------- matrix */
  const matrixState = { category: 'all', channel: 'all', capability: 'all', query: '' };

  function capCell(row, kind) {
    const yes = kind === 'pull' ? row.pull : kind === 'push' ? row.push : false;
    if (kind === 'create') {
      if (row.create === 'direct') return `<span class="cap cap-yes" title="${esc(UI[lang].yes)}">✓</span>`;
      if (row.create === 'file') return `<span class="cap-file" title="${esc(UI[lang].file)}">file</span>`;
      if (row.create === 'rf') return `<span class="cap-rf" title="${esc(UI[lang].rf)}">RF</span>`;
      return `<span class="cap-no" title="${esc(UI[lang].no)}">—</span>`;
    }
    if (kind === 'delete') {
      if (row.delete === 'direct') return `<span class="cap cap-yes" title="${esc(UI[lang].yes)}">✓</span>`;
      if (row.delete === 'tmp') return `<span class="cap-tmp" title="${esc(UI[lang].tmp)}">$TMP</span>`;
      return `<span class="cap-no" title="${esc(UI[lang].no)}">—</span>`;
    }
    if (yes) return `<span class="cap cap-yes" title="${esc(UI[lang].yes)}">✓</span>`;
    return `<span class="cap-no" title="${esc(UI[lang].no)}">—</span>`;
  }

  function capValue(row, kind) {
    if (kind === 'create') {
      if (row.create === 'direct') return '✓';
      if (row.create === 'file') return 'file';
      if (row.create === 'rf') return 'RF';
      return '—';
    }
    if (kind === 'delete') {
      if (row.delete === 'direct') return '✓';
      if (row.delete === 'tmp') return '$TMP';
      return '—';
    }
    return kind === 'pull' ? (row.pull ? '✓' : '—') : (row.push ? '✓' : '—');
  }

  function capClass(row, kind) {
    if (kind === 'create') {
      if (row.create === 'direct') return 'cap-yes';
      if (row.create === 'file' || row.create === 'rf') return 'cap-file';
      return 'cap-no';
    }
    if (kind === 'delete') {
      if (row.delete === 'direct') return 'cap-yes';
      if (row.delete === 'tmp') return 'cap-tmp';
      return 'cap-no';
    }
    const yes = kind === 'pull' ? row.pull : row.push;
    return yes ? 'cap-yes' : 'cap-no';
  }

  function channelLabel(channel) {
    return channel === 'adt' ? 'ADT' : channel === 'icf' ? 'ICF' : 'AUTO';
  }

  function matchesCapability(row) {
    const capability = matrixState.capability;
    if (capability === 'create') return row.create !== 'none';
    if (capability === 'push') return row.push;
    if (capability === 'delete') return row.delete !== 'none';
    if (capability === 'readonly') return !row.push && row.create === 'none' && row.delete === 'none';
    return true;
  }

  function filteredRows() {
    const query = matrixState.query.trim().toLowerCase();
    return DATA.filter((row) => {
      if (matrixState.category !== 'all' && row.category !== matrixState.category) return false;
      if (matrixState.channel !== 'all' && row.channel !== matrixState.channel) return false;
      if (!matchesCapability(row)) return false;
      if (!query) return true;
      const haystack = `${row.code} ${row.name} ${row.artifacts} ${categoryLabel(row.category)}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderMatrix() {
    const body = $('#type-rows');
    if (!body) return;
    const rows = filteredRows();
    const count = $('#matrix-count');
    if (count) count.textContent = UI[lang].matrixCount(rows.length, DATA.length);

    const cardHost = $('#type-cards');
    if (rows.length === 0) {
      body.innerHTML = '';
      if (cardHost) cardHost.innerHTML = '';
      const empty = $('#matrix-empty');
      if (empty) empty.hidden = false;
      return;
    }
    const empty = $('#matrix-empty');
    if (empty) empty.hidden = true;

    if (cardHost) {
      cardHost.innerHTML = rows.map((row) => `
        <article class="type-card">
          <div class="type-card-top">
            <span class="type-code">${esc(row.code)}</span>
            <span class="channel-badge ${esc(row.channel)}">${channelLabel(row.channel)}</span>
          </div>
          <h4>${esc(row.name)}</h4>
          <p class="type-card-cat">${esc(categoryLabel(row.category))}</p>
          <div class="type-card-caps">
            ${['create', 'pull', 'push', 'delete'].map((kind) => `<span><small>${esc(UI[lang].caps[kind])}</small><b class="${capClass(row, kind)}">${esc(capValue(row, kind))}</b></span>`).join('')}
          </div>
          <code class="type-card-artifacts">${esc(row.artifacts)}</code>
        </article>
      `).join('');
    }

    body.innerHTML = rows.map((row, index) => `
      <tr style="--i:${index}">
        <td><span class="type-code">${esc(row.code)}</span></td>
        <td>
          <div class="type-name">${esc(row.name)}<span class="type-category">${esc(categoryLabel(row.category))}</span></div>
        </td>
        <td class="cap-col">${capCell(row, 'create')}</td>
        <td class="cap-col">${capCell(row, 'pull')}</td>
        <td class="cap-col">${capCell(row, 'push')}</td>
        <td class="cap-col">${capCell(row, 'delete')}</td>
        <td><span class="channel-badge ${esc(row.channel)}">${channelLabel(row.channel)}</span></td>
        <td class="artifacts-cell"><code title="${esc(row.artifacts)}">${esc(row.artifacts)}</code></td>
      </tr>
    `).join('');
  }

  function wireMatrix() {
    const search = $('#type-search');
    if (search) {
      search.addEventListener('input', () => {
        matrixState.query = search.value;
        renderMatrix();
      });
    }

    const channel = $('#channel-filter');
    if (channel) {
      channel.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-channel]');
        if (!button) return;
        matrixState.channel = button.dataset.channel;
        $$('button', channel).forEach((item) => item.classList.toggle('active', item === button));
        renderMatrix();
      });
    }

    const categories = $('#category-filter');
    if (categories) {
      categories.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-category]');
        if (!button) return;
        matrixState.category = button.dataset.category;
        $$('button', categories).forEach((item) => item.classList.toggle('active', item === button));
        renderMatrix();
      });
    }

    const capability = $('#cap-filter');
    if (capability) {
      capability.addEventListener('change', () => {
        matrixState.capability = capability.value;
        renderMatrix();
      });
    }

    const reset = $('#matrix-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        matrixState.category = 'all';
        matrixState.channel = 'all';
        matrixState.capability = 'all';
        matrixState.query = '';
        if (search) search.value = '';
        if (capability) capability.value = 'all';
        $$('button', categories).forEach((item) => item.classList.toggle('active', item.dataset.category === 'all'));
        $$('button', channel).forEach((item) => item.classList.toggle('active', item.dataset.channel === 'all'));
        renderMatrix();
      });
    }
  }

  /* ---------------------------------------------------------------- commands */
  let activeGroup = 'setup';

  function renderCommands() {
    const tabs = $('#command-tabs');
    const grid = $('#command-grid');
    if (!tabs || !grid) return;
    const groups = ['setup', 'source', 'explore', 'run', 'ship'];
    tabs.innerHTML = groups.map((group) => {
      const count = COMMANDS.filter((command) => command.group === group).length;
      return `<button class="command-tab${group === activeGroup ? ' active' : ''}" type="button" role="tab" aria-selected="${group === activeGroup}" data-group="${group}">${esc(UI[lang].groups[group].label)}<span class="tab-count">${count}</span></button>`;
    }).join('');

    const meta = UI[lang].groups[activeGroup];
    const title = $('#command-group-title');
    const hint = $('#command-group-hint');
    if (title) title.textContent = meta.label;
    if (hint) hint.textContent = meta.hint;

    grid.innerHTML = COMMANDS.filter((command) => command.group === activeGroup).map((command) => `
      <article class="command-card">
        <div class="command-name"><span class="dollar">$</span> abap ${esc(command.name)}</div>
        <p>${esc(lang === 'zh' ? command.zh : command.en)}</p>
      </article>
    `).join('');
  }

  function wireCommands() {
    const tabs = $('#command-tabs');
    if (!tabs) return;
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-group]');
      if (!button) return;
      activeGroup = button.dataset.group;
      renderCommands();
    });
    tabs.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const groups = ['setup', 'source', 'explore', 'run', 'ship'];
      const index = groups.indexOf(activeGroup);
      const next = event.key === 'ArrowRight' ? (index + 1) % groups.length : (index - 1 + groups.length) % groups.length;
      activeGroup = groups[next];
      renderCommands();
      const focusTarget = tabs.querySelector(`button[data-group="${activeGroup}"]`);
      if (focusTarget) focusTarget.focus();
    });
  }

  /* ---------------------------------------------------------------- copy */
  let toastTimer = null;

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function handleCopy(text, trigger) {
    const ok = await copyText(text);
    showToast(ok ? UI[lang].copied : UI[lang].copyFailed);
    if (!ok) return;
    if (trigger) {
      trigger.classList.add('copied');
      setTimeout(() => trigger.classList.remove('copied'), 1400);
    }
  }

  function wireCopy() {
    document.addEventListener('click', (event) => {
      const withText = event.target.closest('[data-copy]');
      if (withText) {
        handleCopy(withText.getAttribute('data-copy'), withText);
        return;
      }
      const target = event.target.closest('[data-copy-target]');
      if (target) {
        const id = target.getAttribute('data-copy-target');
        const panel = document.getElementById(id);
        if (panel) handleCopy(panel.textContent, target);
        return;
      }
      const copyButton = event.target.closest('.copy-btn');
      if (copyButton) {
        const code = copyButton.parentElement.querySelector('code');
        if (code) handleCopy(code.textContent, copyButton);
      }
    });
  }

  /* ---------------------------------------------------------------- agent code tabs */
  function setAgentCode(name) {
    $$('.code-tab').forEach((tab) => {
      const active = tab.dataset.code === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $$('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
  }

  function wireAgentCode() {
    $$('.code-tab').forEach((tab) => {
      tab.addEventListener('click', () => setAgentCode(tab.dataset.code));
    });
    const copy = $('.copy-code');
    if (copy) {
      copy.addEventListener('click', () => {
        const panel = $$('[data-panel]').find((item) => !item.hidden);
        if (panel) handleCopy(panel.textContent, copy);
      });
    }
  }

  /* ---------------------------------------------------------------- reveal */
  function wireReveal() {
    const nodes = $$('[data-reveal]');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('revealed'));
      $$('[data-count]').forEach(animateCount);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('revealed');
        $$('[data-count]', entry.target).forEach(animateCount);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -36px' });
    nodes.forEach((node) => observer.observe(node));
  }

  /* ---------------------------------------------------------------- scroll */
  function wireScroll() {
    const header = $('#site-header');
    const progress = $('#scroll-progress');
    let ticking = false;
    const update = () => {
      const y = window.scrollY || document.documentElement.scrollTop;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progress) progress.style.width = `${max > 0 ? Math.min(100, (y / max) * 100) : 0}%`;
      if (header) header.classList.toggle('scrolled', y > 14);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }

  function wireNav() {
    const toggle = $('#menu-btn');
    const links = $('#nav-links');
    if (!toggle || !links) return;
    const close = () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', UI[lang].openMenu);
    };
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? UI[lang].closeMenu : UI[lang].openMenu);
    });
    links.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    document.addEventListener('click', (event) => {
      if (!links.contains(event.target) && !toggle.contains(event.target)) close();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 960) close();
    });
  }

  function wireActiveNav() {
    const links = $$('#nav-links a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const map = new Map();
    links.forEach((link) => {
      const id = link.getAttribute('href').slice(1);
      const section = document.getElementById(id);
      if (section) map.set(section, link);
    });
    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      links.forEach((link) => link.classList.remove('active'));
      for (const [section, link] of map) {
        if (visible.has(section)) {
          link.classList.add('active');
          break;
        }
      }
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });
    map.forEach((_, section) => observer.observe(section));
  }

  function wireCursor() {
    if (reduceMotion || !window.matchMedia('(pointer: fine)').matches) return;
    const glow = $('#cursor-glow');
    if (!glow) return;
    let x = -1000;
    let y = -1000;
    let visible = false;
    let raf = null;
    const paint = () => {
      glow.style.left = `${x}px`;
      glow.style.top = `${y}px`;
      raf = null;
    };
    window.addEventListener('pointermove', (event) => {
      x = event.clientX;
      y = event.clientY;
      if (!visible) {
        visible = true;
        glow.style.opacity = '1';
      }
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => {
      visible = false;
      glow.style.opacity = '0';
    });
  }

  function wireTerminalVisibility() {
    const terminal = $('#hero-terminal');
    if (!terminal || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      terminalVisible = Boolean(entry && entry.isIntersecting);
      if (!terminalVisible) {
        terminalRun += 1;
      } else {
        playTerminal(activeScene);
      }
    }, { threshold: 0.2 });
    observer.observe(terminal);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) terminalRun += 1;
      else if (terminalVisible) playTerminal(activeScene);
    });
  }

  /* ---------------------------------------------------------------- init */
  function init() {
    captureOriginals();
    renderMarquee();
    wireMatrix();
    wireCommands();
    wireCopy();
    wireAgentCode();
    wireScroll();
    wireNav();
    wireActiveNav();
    wireCursor();
    wireReveal();
    wireTerminalVisibility();

    $$('.term-tab').forEach((tab) => {
      tab.addEventListener('click', () => setTerminalTab(tab.dataset.term));
    });

    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    const initial = readStoredLang();
    applyLanguage(initial);
    if (initial === 'en') {
      // applyLanguage resets English from the captured DOM; the initial render is already correct.
      updateStatValues();
    }

    // Only auto-play the terminal when it is on screen; otherwise play on first intersection.
    if (terminalVisible) playTerminal(activeScene);

    $('#lang-toggle')?.addEventListener('click', () => {
      applyLanguage(lang === 'zh' ? 'en' : 'zh');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

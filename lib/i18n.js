/**
 * Translations for the control panel and every bot-facing message.
 * Keys are flat so the page can expose them through `data-i18n`.
 */

import { pluralRu } from './format.js';

export const LANGUAGES = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
];

export const DICT = {
  ru: {
    'panel.subtitle': 'Локальная панель. Слушает только 127.0.0.1 и живёт, пока запущен DSH с плагином.',
    'panel.language': 'Язык',
    'panel.bot': 'Бот',
    'panel.chat': 'Чат',
    'panel.access': 'Доступ',
    'panel.pending': 'В ожидании',
    'panel.groupWarn': 'Это группа: все её участники видят уведомления и ответы.',
    'panel.connection': 'Подключение',
    'panel.token': 'Токен бота от @BotFather',
    'panel.chatId': 'Chat ID (необязательно — привяжется по /start)',
    'panel.whitelist': 'Whitelist: @username или ссылка t.me/username',
    'panel.save': 'Сохранить',
    'panel.test': 'Отправить тест',
    'panel.reset': 'Отвязать чат',
    'panel.hint':
      'Токен хранится в credential-store DSH. После сохранения отправьте боту /start — чат привяжется сам. Пустой whitelist: доступ только у владельца (первый, кто привязал чат); остальные не могут ни писать, ни нажимать кнопки.',
    'panel.events': 'События',
    'panel.empty': 'пока пусто',
    'panel.loading': 'загрузка…',
    'panel.saved': 'Сохранено.',
    'panel.testSent': 'Тестовое сообщение отправлено.',
    'panel.resetDone': 'Привязка снята.',
    'panel.confirmReset': 'Отвязать чат? После этого снова отправьте боту /start.',
    'panel.notBound': 'не привязан',
    'panel.notConnected': 'не подключён',
    'panel.whitelistShort': 'whitelist',
    'panel.pendingLine': 'вопросы: {questions} · разрешения: {approvals}',
    'panel.unreachable': 'панель не отвечает: {error}',

    'bot.welcome.title': '✅ <b>Чат привязан к DSH</b>',
    'bot.welcome.body': 'Сюда будут приходить вопросы агента, запросы разрешений и итоги работы.',
    'bot.status.bot': 'Бот: {value}',
    'bot.status.chat': 'Чат: {value}',
    'bot.status.access': 'Доступ: {value}',
    'bot.status.questions': 'Вопросов в ожидании: {count}',
    'bot.status.approvals': 'Разрешений в ожидании: {count}',
    'bot.status.panel': 'Панель: {url}',
    'bot.help.questions':
      '• Вопросы агента приходят сюда с кнопками — ответьте кнопкой или текстом (reply на сообщение вопроса).',
    'bot.help.approvals': '• Запросы разрешений приходят с кнопками «Разрешить» / «Отклонить».',
    'bot.help.summary': '• Когда ход завершён, приходит выжимка.',
    'bot.help.status': '/status — состояние моста.',
    'bot.help.panel': 'Панель: {url}',
    'bot.deny': '⛔ Этот бот привязан к другому пользователю.',
    'bot.needStart': 'Отправьте /start, чтобы привязать этот чат к DSH.',
    'bot.noQuestion': 'Сейчас нет вопроса, на который нужен ответ. Команды: /status, /help.',
    'bot.noAccess': 'Нет доступа',
    'bot.staleQuestion': 'Вопрос уже неактуален',
    'bot.staleApproval': 'Запрос уже неактуален',
    'bot.unanswered': 'Остались вопросы без ответа',
    'bot.test': '🔔 <b>Тест связи</b>\nDSH ↔ Telegram работает. Сюда будут приходить вопросы и итоги.',
    'bot.question.title': '❓ <b>DSH спрашивает</b>',
    'bot.question.progress': '<b>Вопрос {index} из {total}</b>',
    'bot.question.details': '📄 <b>Детали</b>',
    'bot.question.multiHint': 'Можно выбрать несколько, затем «Готово».',
    'bot.question.textHint': 'Ответьте текстом на это сообщение.',
    'bot.question.other': '✏️ Свой ответ',
    'bot.question.done': '✅ Готово',
    'bot.question.awaiting': '✏️ <i>Отправьте текст ответом на это сообщение.</i>',
    'bot.question.answeredLocal': '✅ <i>Ответ дан в DSH.</i>',
    'bot.question.answeredTelegram': '✅ <i>Ответ принят.</i>',
    'bot.question.cancelled': '⌛ <i>Вопрос снят.</i>',
    'bot.question.inactive': '⚠️ <i>Вопрос больше не активен.</i>',
    'bot.approval.title': '🛡️ <b>Нужно разрешение</b>',
    'bot.approval.tool': 'Инструмент: <code>{tool}</code>',
    'bot.approval.allow': '✅ Разрешить',
    'bot.approval.deny': '⛔ Отклонить',
    'bot.approval.allowed': '✅ <b>Разрешено</b>',
    'bot.approval.rejected': '⛔ <b>Отклонено</b>',
    'bot.approval.cancelled': '⌛ <b>Отменено</b>',
    'bot.approval.unavailable': '⌛ <b>Недоступно</b>',
    'bot.approval.local': '✅ <b>Решено в DSH</b>',
    'bot.command.start': 'Привязать чат и показать статус',
    'bot.command.status': 'Статус моста',
    'bot.command.help': 'Как это работает',

    'summary.done': '✅ <b>DSH завершил работу</b>',
    'summary.aborted': '⏹ <b>DSH остановлен</b>',
    'summary.error': '⚠️ <b>DSH завершился с ошибкой</b>',
    'summary.unknownError': 'неизвестная ошибка',
    'summary.folder': '📁 #{name}',
    'summary.duration': '⏱️ {value}',
    'summary.tools': '🛠 {value}',
    'summary.session': 'Сессия {id}',

    'error.chatId': 'chat id должен быть числом (например -1001234567890) или @именем канала',
    'error.allowedUser':
      'не понял пользователя "{value}": нужен @username, ссылка t.me/username или числовой id',
    'error.tokenRejected': 'Telegram не принял токен: {error}',
    'error.botNotRunning': 'бот ещё не запущен: сохраните корректный токен',
    'error.chatNotBound': 'чат не привязан: отправьте боту /start',
    'error.forbidden': 'доступ запрещён',
    'error.badJson': 'тело запроса должно быть корректным JSON',
    'error.tooLarge': 'тело запроса слишком большое',
    'error.notFound': 'не найдено',

    'log.panel': 'панель управления: {url}',
    'log.build': 'build {build}',
    'log.noToken': 'токен не задан — откройте панель и вставьте токен @BotFather',
    'log.botReady': 'бот @{username} на связи',
    'log.botFailed': 'бот не запустился: {error}',
    'log.tokenSaved': 'токен сохранён (@{username})',
    'log.chatBound': 'чат привязан: {chatId}',
    'log.chatUnbound': 'привязка чата снята',
    'log.whitelist': 'whitelist: {users}',
    'log.whitelistEmpty': 'whitelist пуст — доступ у владельца',
    'log.bindingReset': 'привязка чата сброшена',
    'log.testSent': 'тестовое сообщение отправлено',
    'log.summaryFailed': 'не удалось отправить итог: {error}',
    'log.questionForwarded': 'вопрос → Telegram ({count})',
    'log.approvalForwarded': 'аппрув → Telegram ({tool})',
    'log.owner': 'владелец: {owner}',
    'log.denied': 'доступ отклонён: user {id}',
    'log.deniedCallback': 'доступ отклонён (callback): user {id}',
    'log.editQuestionFailed': 'не удалось обновить вопрос: {error}',
    'log.answerFailed': 'не удалось записать ответ: {error}',
    'log.closeQuestionFailed': 'не удалось закрыть вопрос: {error}',
    'log.sendApprovalFailed': 'не удалось отправить аппрув: {error}',
    'log.closeApprovalFailed': 'не удалось закрыть аппрув: {error}',
    'log.denyFailed': 'не удалось ответить отказом: {error}',
    'log.credentialFailed': 'credential-store отклонил токен: {error}',
    'log.sessionHandlerFailed': 'ошибка обработчика сессии: {error}',
    'log.language': 'язык: {language}',
  },

  en: {
    'panel.subtitle': 'Local panel. Bound to 127.0.0.1 only; lives while DSH is running with the plugin.',
    'panel.language': 'Language',
    'panel.bot': 'Bot',
    'panel.chat': 'Chat',
    'panel.access': 'Access',
    'panel.pending': 'Pending',
    'panel.groupWarn': 'This is a group: every member sees notifications and replies.',
    'panel.connection': 'Connection',
    'panel.token': 'Bot token from @BotFather',
    'panel.chatId': 'Chat ID (optional — bound by /start)',
    'panel.whitelist': 'Whitelist: @username or a t.me/username link',
    'panel.save': 'Save',
    'panel.test': 'Send test',
    'panel.reset': 'Unbind chat',
    'panel.hint':
      'The token is stored in the DSH credential store. After saving, send /start to the bot — the chat binds automatically. Empty whitelist: only the owner (the first user who bound the chat) has access; others can neither write nor press buttons.',
    'panel.events': 'Events',
    'panel.empty': 'nothing yet',
    'panel.loading': 'loading…',
    'panel.saved': 'Saved.',
    'panel.testSent': 'Test message sent.',
    'panel.resetDone': 'Chat unbound.',
    'panel.confirmReset': 'Unbind the chat? Send /start to the bot again afterwards.',
    'panel.notBound': 'not bound',
    'panel.notConnected': 'not connected',
    'panel.whitelistShort': 'whitelist',
    'panel.pendingLine': 'questions: {questions} · approvals: {approvals}',
    'panel.unreachable': 'panel is not responding: {error}',

    'bot.welcome.title': '✅ <b>Chat linked to DSH</b>',
    'bot.welcome.body': 'Agent questions, approval requests and turn summaries will arrive here.',
    'bot.status.bot': 'Bot: {value}',
    'bot.status.chat': 'Chat: {value}',
    'bot.status.access': 'Access: {value}',
    'bot.status.questions': 'Pending questions: {count}',
    'bot.status.approvals': 'Pending approvals: {count}',
    'bot.status.panel': 'Panel: {url}',
    'bot.help.questions':
      '• Agent questions arrive with buttons — answer with a button or by replying to the question message with text.',
    'bot.help.approvals': '• Approval requests arrive with Allow / Deny buttons.',
    'bot.help.summary': '• When a turn finishes, a summary arrives.',
    'bot.help.status': '/status — bridge state.',
    'bot.help.panel': 'Panel: {url}',
    'bot.deny': '⛔ This bot is bound to another user.',
    'bot.needStart': 'Send /start to link this chat to DSH.',
    'bot.noQuestion': 'There is no question to answer right now. Commands: /status, /help.',
    'bot.noAccess': 'No access',
    'bot.staleQuestion': 'This question is no longer active',
    'bot.staleApproval': 'This request is no longer active',
    'bot.unanswered': 'Some questions are still unanswered',
    'bot.test': '🔔 <b>Connection test</b>\nDSH ↔ Telegram works. Questions and summaries will arrive here.',
    'bot.question.title': '❓ <b>DSH asks</b>',
    'bot.question.progress': '<b>Question {index} of {total}</b>',
    'bot.question.details': '📄 <b>Details</b>',
    'bot.question.multiHint': 'Pick any number of options, then press Done.',
    'bot.question.textHint': 'Reply to this message with text.',
    'bot.question.other': '✏️ Other answer',
    'bot.question.done': '✅ Done',
    'bot.question.awaiting': '✏️ <i>Reply to this message with your answer.</i>',
    'bot.question.answeredLocal': '✅ <i>Answered in DSH.</i>',
    'bot.question.answeredTelegram': '✅ <i>Answer accepted.</i>',
    'bot.question.cancelled': '⌛ <i>Question withdrawn.</i>',
    'bot.question.inactive': '⚠️ <i>The question is no longer active.</i>',
    'bot.approval.title': '🛡️ <b>Approval required</b>',
    'bot.approval.tool': 'Tool: <code>{tool}</code>',
    'bot.approval.allow': '✅ Allow',
    'bot.approval.deny': '⛔ Deny',
    'bot.approval.allowed': '✅ <b>Allowed</b>',
    'bot.approval.rejected': '⛔ <b>Denied</b>',
    'bot.approval.cancelled': '⌛ <b>Cancelled</b>',
    'bot.approval.unavailable': '⌛ <b>Unavailable</b>',
    'bot.approval.local': '✅ <b>Decided in DSH</b>',
    'bot.command.start': 'Link this chat and show status',
    'bot.command.status': 'Bridge status',
    'bot.command.help': 'How it works',

    'summary.done': '✅ <b>DSH finished the turn</b>',
    'summary.aborted': '⏹ <b>DSH stopped</b>',
    'summary.error': '⚠️ <b>DSH failed</b>',
    'summary.unknownError': 'unknown error',
    'summary.folder': '📁 #{name}',
    'summary.duration': '⏱️ {value}',
    'summary.tools': '🛠 {value}',
    'summary.session': 'Session {id}',

    'error.chatId': 'chat id must be a number (for example -1001234567890) or @channelname',
    'error.allowedUser': 'could not parse "{value}": use @username, a t.me/username link or a numeric id',
    'error.tokenRejected': 'Telegram rejected the token: {error}',
    'error.botNotRunning': 'the bot is not running yet: save a valid token',
    'error.chatNotBound': 'the chat is not bound: send /start to the bot',
    'error.forbidden': 'forbidden',
    'error.badJson': 'the request body must be valid JSON',
    'error.tooLarge': 'the request body is too large',
    'error.notFound': 'not found',

    'log.panel': 'control panel: {url}',
    'log.build': 'build {build}',
    'log.noToken': 'no token configured — open the panel and paste a @BotFather token',
    'log.botReady': 'bot @{username} is online',
    'log.botFailed': 'the bot did not start: {error}',
    'log.tokenSaved': 'token saved (@{username})',
    'log.chatBound': 'chat bound: {chatId}',
    'log.chatUnbound': 'chat unbound',
    'log.whitelist': 'whitelist: {users}',
    'log.whitelistEmpty': 'whitelist is empty — owner-only access',
    'log.bindingReset': 'chat binding reset',
    'log.testSent': 'test message sent',
    'log.summaryFailed': 'could not send the summary: {error}',
    'log.questionForwarded': 'question → Telegram ({count})',
    'log.approvalForwarded': 'approval → Telegram ({tool})',
    'log.owner': 'owner: {owner}',
    'log.denied': 'access denied: user {id}',
    'log.deniedCallback': 'access denied (callback): user {id}',
    'log.editQuestionFailed': 'could not update the question: {error}',
    'log.answerFailed': 'could not record the answer: {error}',
    'log.closeQuestionFailed': 'could not close the question: {error}',
    'log.sendApprovalFailed': 'could not send the approval: {error}',
    'log.closeApprovalFailed': 'could not close the approval: {error}',
    'log.denyFailed': 'could not send the denial: {error}',
    'log.credentialFailed': 'the credential store rejected the token: {error}',
    'log.sessionHandlerFailed': 'session handler failed: {error}',
    'log.language': 'language: {language}',
  },

  zh: {
    'panel.subtitle': '本地面板。仅监听 127.0.0.1，DSH 运行期间有效。',
    'panel.language': '语言',
    'panel.bot': '机器人',
    'panel.chat': '聊天',
    'panel.access': '访问',
    'panel.pending': '等待中',
    'panel.groupWarn': '这是群聊：所有成员都能看到通知和回复。',
    'panel.connection': '连接',
    'panel.token': '来自 @BotFather 的机器人令牌',
    'panel.chatId': 'Chat ID（可选，通过 /start 绑定）',
    'panel.whitelist': '白名单：@用户名 或 t.me/用户名 链接',
    'panel.save': '保存',
    'panel.test': '发送测试',
    'panel.reset': '解除聊天绑定',
    'panel.hint':
      '令牌保存在 DSH 凭据库中。保存后向机器人发送 /start 即可自动绑定聊天。白名单为空时，只有所有者（第一个绑定聊天的用户）可以访问；其他人既不能发消息，也不能点击按钮。',
    'panel.events': '事件',
    'panel.empty': '暂无事件',
    'panel.loading': '加载中…',
    'panel.saved': '已保存。',
    'panel.testSent': '测试消息已发送。',
    'panel.resetDone': '已解除绑定。',
    'panel.confirmReset': '解除聊天绑定？之后请重新向机器人发送 /start。',
    'panel.notBound': '未绑定',
    'panel.notConnected': '未连接',
    'panel.whitelistShort': '白名单',
    'panel.pendingLine': '问题：{questions} · 授权：{approvals}',
    'panel.unreachable': '面板无响应：{error}',

    'bot.welcome.title': '✅ <b>聊天已连接到 DSH</b>',
    'bot.welcome.body': '这里会收到代理的问题、授权请求和工作总结。',
    'bot.status.bot': '机器人：{value}',
    'bot.status.chat': '聊天：{value}',
    'bot.status.access': '访问：{value}',
    'bot.status.questions': '待回答问题：{count}',
    'bot.status.approvals': '待处理授权：{count}',
    'bot.status.panel': '面板：{url}',
    'bot.help.questions': '• 代理的问题会带按钮发到这里——点击按钮，或直接回复该消息作答。',
    'bot.help.approvals': '• 授权请求会带有“允许”/“拒绝”按钮。',
    'bot.help.summary': '• 每轮结束后会收到一条总结。',
    'bot.help.status': '/status — 桥接状态。',
    'bot.help.panel': '面板：{url}',
    'bot.deny': '⛔ 该机器人已绑定其他用户。',
    'bot.needStart': '发送 /start 将此聊天连接到 DSH。',
    'bot.noQuestion': '当前没有需要回答的问题。命令：/status、/help。',
    'bot.noAccess': '无访问权限',
    'bot.staleQuestion': '该问题已失效',
    'bot.staleApproval': '该请求已失效',
    'bot.unanswered': '还有问题未回答',
    'bot.test': '🔔 <b>连接测试</b>\nDSH ↔ Telegram 工作正常。问题和总结会发到这里。',
    'bot.question.title': '❓ <b>DSH 提问</b>',
    'bot.question.progress': '<b>第 {index} 题，共 {total} 题</b>',
    'bot.question.details': '📄 <b>详情</b>',
    'bot.question.multiHint': '可多选，然后点击“完成”。',
    'bot.question.textHint': '请回复此消息并输入文字。',
    'bot.question.other': '✏️ 自定义回答',
    'bot.question.done': '✅ 完成',
    'bot.question.awaiting': '✏️ <i>请回复此消息发送答案。</i>',
    'bot.question.answeredLocal': '✅ <i>已在 DSH 中回答。</i>',
    'bot.question.answeredTelegram': '✅ <i>答案已接受。</i>',
    'bot.question.cancelled': '⌛ <i>问题已撤回。</i>',
    'bot.question.inactive': '⚠️ <i>问题已失效。</i>',
    'bot.approval.title': '🛡️ <b>需要授权</b>',
    'bot.approval.tool': '工具：<code>{tool}</code>',
    'bot.approval.allow': '✅ 允许',
    'bot.approval.deny': '⛔ 拒绝',
    'bot.approval.allowed': '✅ <b>已允许</b>',
    'bot.approval.rejected': '⛔ <b>已拒绝</b>',
    'bot.approval.cancelled': '⌛ <b>已取消</b>',
    'bot.approval.unavailable': '⌛ <b>不可用</b>',
    'bot.approval.local': '✅ <b>已在 DSH 中处理</b>',
    'bot.command.start': '绑定聊天并显示状态',
    'bot.command.status': '桥接状态',
    'bot.command.help': '使用说明',

    'summary.done': '✅ <b>DSH 已完成本轮</b>',
    'summary.aborted': '⏹ <b>DSH 已停止</b>',
    'summary.error': '⚠️ <b>DSH 执行出错</b>',
    'summary.unknownError': '未知错误',
    'summary.folder': '📁 #{name}',
    'summary.duration': '⏱️ {value}',
    'summary.tools': '🛠 {value}',
    'summary.session': '会话 {id}',

    'error.chatId': 'chat id 必须是数字（例如 -1001234567890）或 @频道名',
    'error.allowedUser': '无法解析“{value}”：请使用 @用户名、t.me/用户名 链接或数字 id',
    'error.tokenRejected': 'Telegram 拒绝了该令牌：{error}',
    'error.botNotRunning': '机器人尚未启动：请保存有效的令牌',
    'error.chatNotBound': '聊天未绑定：请向机器人发送 /start',
    'error.forbidden': '禁止访问',
    'error.badJson': '请求体必须是有效的 JSON',
    'error.tooLarge': '请求体过大',
    'error.notFound': '未找到',

    'log.panel': '控制面板：{url}',
    'log.build': 'build {build}',
    'log.noToken': '未配置令牌——打开面板并粘贴 @BotFather 令牌',
    'log.botReady': '机器人 @{username} 已上线',
    'log.botFailed': '机器人启动失败：{error}',
    'log.tokenSaved': '令牌已保存（@{username}）',
    'log.chatBound': '聊天已绑定：{chatId}',
    'log.chatUnbound': '聊天已解绑',
    'log.whitelist': '白名单：{users}',
    'log.whitelistEmpty': '白名单为空——仅所有者可访问',
    'log.bindingReset': '聊天绑定已重置',
    'log.testSent': '测试消息已发送',
    'log.summaryFailed': '无法发送总结：{error}',
    'log.questionForwarded': '问题 → Telegram（{count}）',
    'log.approvalForwarded': '授权 → Telegram（{tool}）',
    'log.owner': '所有者：{owner}',
    'log.denied': '拒绝访问：用户 {id}',
    'log.deniedCallback': '拒绝访问（回调）：用户 {id}',
    'log.editQuestionFailed': '无法更新问题：{error}',
    'log.answerFailed': '无法记录答案：{error}',
    'log.closeQuestionFailed': '无法关闭问题：{error}',
    'log.sendApprovalFailed': '无法发送授权请求：{error}',
    'log.closeApprovalFailed': '无法关闭授权请求：{error}',
    'log.denyFailed': '无法发送拒绝消息：{error}',
    'log.credentialFailed': '凭据库拒绝了令牌：{error}',
    'log.sessionHandlerFailed': '会话处理失败：{error}',
    'log.language': '语言：{language}',
  },
};

export function normalizeLanguage(value, fallback = 'en') {
  const mapped = mapLocale(value);
  if (mapped) return mapped;
  const text = String(value ?? '').toLowerCase();
  if (text.startsWith('ru')) return 'ru';
  if (text.startsWith('en')) return 'en';
  if (text.startsWith('zh')) return 'zh';
  return LANGUAGES.some((item) => item.id === fallback) ? fallback : 'en';
}

/** Map a locale-ish string (`ru-RU`, `zh_CN.UTF-8`, `en_US`) to a supported id. */
function mapLocale(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return '';
  if (text === 'c' || text === 'posix' || text.startsWith('c.') || text.startsWith('c_')) return '';
  const primary = text.split(/[._@-]/)[0];
  if (primary === 'ru') return 'ru';
  if (primary === 'en') return 'en';
  if (primary === 'zh') return 'zh';
  return '';
}

/**
 * Detect the host language when the user has not chosen one yet.
 * Uses POSIX locale variables first, then the JS/Electron locale. Anything
 * outside ru/en/zh falls back to English.
 */
export function detectSystemLanguage({ env = process.env, locale } = {}) {
  const candidates = [
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
    String(env.LANGUAGE ?? '').split(':')[0],
    locale ?? Intl.DateTimeFormat().resolvedOptions().locale,
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    // `C`/`POSIX` are "no locale", not a language: keep looking.
    if (lower === 'c' || lower === 'posix' || lower.startsWith('c.') || lower.startsWith('c_')) continue;
    // The first real locale wins. An unsupported system language means English,
    // not a later layer that happens to be supported.
    return mapLocale(text) || 'en';
  }
  return 'en';
}

export function translate(lang, key, params) {
  const table = DICT[lang] ?? DICT.ru;
  const template = table[key] ?? DICT.en[key] ?? DICT.ru[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    params && params[name] !== undefined ? String(params[name]) : match,
  );
}

/** Localized turn duration: `5 с`, `2m 5s`, `2 分 5 秒`. */
export function durationText(ms, lang = 'ru') {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (lang === 'en') {
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
  if (lang === 'zh') {
    if (hours > 0) return `${hours} 小时 ${minutes} 分`;
    if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
    return `${seconds} 秒`;
  }
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин ${seconds} с`;
  return `${seconds} с`;
}

/** Localized tool count: `3 инструмента`, `3 tools`, `3 个工具`. */
export function toolsText(count, lang = 'ru') {
  if (lang === 'en') return `${count} ${count === 1 ? 'tool' : 'tools'}`;
  if (lang === 'zh') return `${count} 个工具`;
  return `${count} ${pluralRu(count, 'инструмент', 'инструмента', 'инструментов')}`;
}

export const LANGUAGE_IDS = LANGUAGES.map((item) => item.id);

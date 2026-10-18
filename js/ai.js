// Точка розширення для аналізу змісту за допомогою ШІ (v2).
// Вмикається прапорцем, коли з'явиться серверний проксі з ключем API (ключ не можна зберігати на клієнті).
// На сервер надсилається лише текст і числові метрики — без відео й аудіо.
export const AI_ENABLED = false;
export const AI_ENDPOINT = '';

export async function analyzeWithAI({ transcript, cardOrScript, metrics }) {
  if (!AI_ENABLED || !AI_ENDPOINT) throw new Error('AI disabled');
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, cardOrScript, metrics }),
  });
  if (!res.ok) throw new Error('AI request failed: ' + res.status);
  return res.json(); // { sections, markup, tips }
}

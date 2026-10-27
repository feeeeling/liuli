const assert = require("node:assert/strict");
const test = require("node:test");
const { consumeSSE } = require("../stream.cjs");

test("SSE survives single-byte UTF-8 chunks, CRLF and a final event without a blank line", async () => {
  const bytes = new TextEncoder().encode(
    'event: delta\r\ndata: {"text":"你好 🌿"}\r\n\r\nevent: done\ndata: {"text":"完成"}',
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  );
  const events = [];
  await consumeSSE(response, (event) => events.push(event));
  assert.deepEqual(events, [
    { event: "delta", data: { text: "你好 🌿" } },
    { event: "done", data: { text: "完成" } },
  ]);
});

test("SSE reports HTTP, model and truncated-connection errors", async () => {
  await assert.rejects(
    consumeSSE(new Response('{"error":"需要登录"}', { status: 401 }), () => {}),
    /需要登录/,
  );
  await assert.rejects(
    consumeSSE(
      new Response('event: error\ndata: {"message":"模型不可用"}\n\n'),
      () => {},
    ),
    /模型不可用/,
  );
  await assert.rejects(
    consumeSSE(
      new Response('event: delta\ndata: {"text":"部分结果"}\n\n'),
      () => {},
    ),
    /连接已中断/,
  );
});

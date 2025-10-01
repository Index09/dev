// src/handlers/autoReply.js
module.exports = (meta) => {
  return async (msg, client) => {
    try {
      if (!msg.body) return;
      if (msg.from === 'status@broadcast') return;
      const body = msg.body.toLowerCase().trim();
      if (body === 'hello') {
        await msg.reply(`👋 Hi from ${meta.id}`);
        return;
      }
      const reply = meta.autoReply || 'Thanks — we will reply soon';
      await msg.reply(reply);
    } catch (err) {
      console.error('autoReply error', err);
    }
  };
};
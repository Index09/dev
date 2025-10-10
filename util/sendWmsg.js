import instanceManager from "../instanceManager.js";

const sendWmsg = async (msg, phone) => {
  const socket = instanceManager.getClient("user_1");

  phone = phone.replace(/[^0-9]/g, "");
  let chatId = `${phone}@s.whatsapp.net`;
  if (phone.includes("-")) {
    chatId = `${phone}@g.us`;
  }
  if(!socket){
    return
  }

  await socket.sendMessage(chatId, { text: msg });
};

export default sendWmsg;

import axios from "axios";

export async function sendTelegram(botToken, chatId, signal, symbol, price, time) {
  const text = `🚨 إشارة ${signal === "buy" ? "شراء" : "بيع"}\n📊 العملة: ${symbol}\n💰 السعر: ${price}\n⏰ التوقيت: ${new Date(time).toLocaleString("ar-EG")}`;
  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  });
}

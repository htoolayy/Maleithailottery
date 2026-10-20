const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

// ================= Configurations (ထည့်သွင်းပြီး) =================
const SUPABASE_URL = 'https://djwylstufwdlihvkwlvc.supabase.co';
const SUPABASE_SERVICE_KEY = 'sb_secret_X1ZfpBTRVBD68pwqEfwpuQ_g_9knOsO';
const TELEGRAM_TOKEN = '8747508487:AAFEVj_W3lHjekUEIZWr_xOsspkkLCYCrH4';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Telegram Bot /start စာပို့လာသူများ၏ Chat ID ကို အလိုအလျောက် မှတ်သားခြင်း
bot.onText(/\/start (.+)/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    const orderId = match[1];
    await supabase.from('orders').update({ telegram_chat_id: chatId.toString() }).eq('id', orderId);
    bot.sendMessage(chatId, `မင်္ဂလာပါခင်ဗျာ၊ အော်ဒါ [${orderId}] ကို ချိတ်ဆက်ပြီးပါပြီ။ ငွေလွှဲအတည်ပြုပြီးသည်နှင့် ထီလက်မှတ်ပုံကို ဤနေရာသို့ ပို့ပေးပါမည်။`);
  } catch (err) {
    console.error('Bot start error:', err);
  }
});

// ထီလက်မှတ်ပုံနှင့် စာသား ခွဲပို့ပေးသည့် Function
async function deliverTicket(order) {
  const { data: fileData, error: urlError } = await supabase.storage
    .from('ticket-images')
    .createSignedUrl(order.tickets.image_path, 120);

  if (urlError) throw urlError;

  const ticketImageUrl = fileData.signedUrl;
  const textMsg = `${order.ticket_number} နံပါတ်ကို ကံစမ်းထားပါသည်၊ ကံထူးပါစေခင်ဗျာ။`;

  if (order.telegram_chat_id) {
    // ၁။ လက်မှတ်ပုံ အရင်ပို့မည်
    await bot.sendPhoto(order.telegram_chat_id, ticketImageUrl);
    // ၂။ ရှာဖွေရလွယ်စေမည့် စာသား သီးသန့်ထပ်ပို့မည်
    await bot.sendMessage(order.telegram_chat_id, textMsg);
  }

  // Database တွင် Status ပြောင်းလဲခြင်း
  await supabase.from('orders').update({ status: 'delivered' }).eq('id', order.id);
  await supabase.from('tickets').update({ status: 'sold

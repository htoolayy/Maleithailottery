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

// ================= Configurations (Key အမှန် ထည့်သွင်းပြီး) =================
const SUPABASE_URL = 'https://djwylstufwdlihvkwlvc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqd3lsc3R1ZndkbGlodmt3bHZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjQ3NTM2OSwiZXhwIjoyMTA4MDUxMzY5fQ.VQNHopek07QEmmP_J7giWm7wlUr_Eyq1rSVLsNoaCes';
const TELEGRAM_TOKEN = '8747508487:AAFEVj_W3lHjekUEIZWr_xOsspkkLCYCrH4';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.onText(/\/start (.+)/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    const orderId = match[1];
    await supabase.from('orders').update({ telegram_chat_id: chatId.toString() }).eq('id', orderId);
    bot.sendMessage(chatId, `Order [${orderId}] ချိတ်ဆက်ပြီးပါပြီ။ ငွေလွှဲအတည်ပြုပြီးပါက ထီလက်မှတ်ပုံ ပို့ပေးပါမည်။`);
  } catch (err) {
    console.error('Bot start error:', err);
  }
});

async function deliverTicket(order) {
  const { data: fileData, error: urlError } = await supabase.storage
    .from('ticket-images')
    .createSignedUrl(order.tickets.image_path, 120);

  if (urlError) throw urlError;

  const ticketImageUrl = fileData.signedUrl;
  const textMsg = `ထီနံပါတ်: ${order.ticket_number}\nကျသင့်ငွေ: ${order.tickets.price ? Number(order.tickets.price).toLocaleString() : '15,000'} ကျပ်\nကံထူးပါစေခင်ဗျာ။`;

  if (order.telegram_chat_id) {
    await bot.sendPhoto(order.telegram_chat_id, ticketImageUrl);
    await bot.sendMessage(order.telegram_chat_id, textMsg);
  }

  await supabase.from('orders').update({ status: 'delivered' }).eq('id', order.id);
  await supabase.from('tickets').update({ status: 'sold' }).eq('id', order.ticket_id);
}

// ထီလက်မှတ်နှင့် စျေးနှုန်း တင်သွင်းသည့် API
app.post('/api/admin/auto-upload', upload.single('ticket_image'), async (req, res) => {
  try {
    const { ticket_number, price } = req.body;
    if (!ticket_number || !req.file) {
      return res.status(400).json({ error: 'အချက်အလက် မပြည့်စုံပါ' });
    }
    const fileName = `${Date.now()}_${ticket_number}.jpg`;

    const { error: storageError } = await supabase.storage
      .from('ticket-images')
      .upload(fileName, req.file.buffer, { contentType: 'image/jpeg' });

    if (storageError) throw storageError;

    const ticketPrice = parseInt(price, 10) || 15000;

    const { error: dbError } = await supabase
      .from('tickets')
      .insert([{
        ticket_number,
        image_path: fileName,
        status: 'available',
        price: ticketPrice
      }]);

    if (dbError) throw dbError;

    res.json({ success: true, message: 'Uploaded successfully' });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tickets', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('id, ticket_number, price')
      .eq('status', 'available');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/create-order', async (req, res) => {
  try {
    const { order_id, ticket_id, ticket_number, channel, payment_method } = req.body;
    const { error } = await supabase.from('orders').insert([{
      id: order_id,
      ticket_id,
      ticket_number,
      channel: channel || 'telegram',
      payment_method: payment_method || 'kpay',
      status: 'pending'
    }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payment-notification', async (req, res) => {
  try {
    const { notification_text } = req.body;
    const match = (notification_text || '').match(/ORD\d{6}/i);
    if (!match) return res.send('No Order ID matched');

    const orderId = match[0].toUpperCase();
    const { data: order } = await supabase
      .from('orders')
      .select('*, tickets(*)')
      .eq('id', orderId)
      .eq('status', 'pending')
      .single();

    if (order) {
      await deliverTicket(order);
      return res.json({ success: true, message: `Order ${orderId} delivered auto!` });
    }
    res.send('Order not found or already processed');
  } catch (err) {
    console.error('Noti processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payment-webhook', async (req, res) => {
  try {
    const { order_id } = req.body;
    const { data: order } = await supabase
      .from('orders')
      .select('*, tickets(*)')
      .eq('id', order_id)
      .single();

    if (order) {
      await deliverTicket(order);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Order not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

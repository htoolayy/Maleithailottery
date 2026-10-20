const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

// ================= Supabase Configurations =================
const SUPABASE_URL = 'https://djwylstufwdlihvkwlvc.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqd3lsc3R1ZndkbGlodmt3bHZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjQ3NTM2OSwiZXhwIjoyMTA4MDUxMzY5fQ.VQNHopek07QEmmP_J7giWm7wlUr_Eyq1rSVLsNoaCes';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ၁။ Admin မှ ထီလက်မှတ် တင်သွင်းခြင်း
app.post('/api/admin/auto-upload', upload.single('ticket_image'), async (req, res) => {
  try {
    const { ticket_number, price } = req.body;
    if (!ticket_number || !req.file) {
      return res.status(400).json({ error: 'အချက်အလက် မပြည့်စုံပါ' });
    }
    const fileName = `t_${Date.now()}_${ticket_number}.jpg`;

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

// ၂။ ရောင်းရန်ရှိသော ထီလက်မှတ်များ ခေါ်ယူခြင်း
app.get('/api/tickets', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('status', 'available')
      .order('id', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Tickets API Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ၃။ ဝယ်သူမှ ငွေလွှဲစလစ် (Slip) တင်သွင်းခြင်း (စာလုံးရေ ၂၀ အောက် အတိုချုံ့ထားသည်)
app.post('/api/submit-order', upload.single('slip_image'), async (req, res) => {
  try {
    const { order_id, ticket_id, ticket_number, customer_contact } = req.body;
    if (!order_id || !ticket_id || !req.file || !customer_contact) {
      return res.status(400).json({ error: 'အချက်အလက် ပြည့်စုံစွာ ဖြည့်ပေးပါ' });
    }

    // စာလုံးရေ ၂၀ မကျော်စေရန် အမည်တို အသုံးပြုခြင်း
    const slipFileName = `s_${order_id}.jpg`;

    const { error: storageError } = await supabase.storage
      .from('ticket-images')
      .upload(slipFileName, req.file.buffer, { contentType: 'image/jpeg', upsert: true });

    if (storageError) throw storageError;

    // Database အကွက် ၂၀ မကျော်စေရန် ကာကွယ်ထားခြင်း
    const safeContact = String(customer_contact).trim().slice(0, 20);

    const { error: dbError } = await supabase.from('orders').insert([{
      id: order_id,
      ticket_id,
      ticket_number,
      telegram_chat_id: safeContact,
      channel: slipFileName,
      payment_method: 'slip_transfer',
      status: 'pending'
    }]);

    if (dbError) throw dbError;

    res.json({ success: true });
  } catch (err) {
    console.error('Submit Order Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ၄။ Admin စစ်ဆေးရန် Orders များကို ဆွဲယူခြင်း
app.get('/api/admin/pending-orders', async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'pending')
      .order('id', { ascending: false });

    if (error) throw error;
    if (!orders || orders.length === 0) {
      return res.json([]);
    }

    const ticketIds = orders.map(o => o.ticket_id).filter(Boolean);
    let ticketMap = {};

    if (ticketIds.length > 0) {
      const { data: ticketsData } = await supabase
        .from('tickets')
        .select('*')
        .in('id', ticketIds);

      (ticketsData || []).forEach(t => {
        ticketMap[t.id] = t;
      });
    }

    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        const ticket = ticketMap[order.ticket_id] || {};
        let ticketImgUrl = '';
        let slipImgUrl = '';

        if (ticket.image_path) {
          const { data } = await supabase.storage
            .from('ticket-images')
            .createSignedUrl(ticket.image_path, 3600);
          ticketImgUrl = data?.signedUrl || '';
        }

        if (order.channel) {
          const { data } = await supabase.storage
            .from('ticket-images')
            .createSignedUrl(order.channel, 3600);
          slipImgUrl = data?.signedUrl || '';
        }

        return {
          ...order,
          tickets: ticket,
          ticket_image_url: ticketImgUrl,
          slip_image_url: slipImgUrl
        };
      })
    );

    res.json(enrichedOrders);
  } catch (err) {
    console.error('Pending Orders Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ၅။ Order အပြီးသတ်ခြင်း
app.post('/api/admin/complete-order', async (req, res) => {
  try {
    const { order_id, ticket_id } = req.body;
    await supabase.from('orders').update({ status: 'delivered' }).eq('id', order_id);
    await supabase.from('tickets').update({ status: 'sold' }).eq('id', ticket_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

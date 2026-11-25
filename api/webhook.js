import crypto from 'crypto';

// Disable automatic body parsing so we can verify Paystack's raw signature accurately
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await getRawBody(req);
    const secret = process.env.PAYSTACK_SECRET_KEY;

    // 1. Verify Paystack HMAC-SHA512 signature
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    if (!signature || hash !== signature) {
      return res.status(401).json({ error: 'Invalid Paystack signature' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));

    // 2. Only trigger when a payment succeeds
    if (event.event === 'charge.success') {
      const data = event.data;
      const amountNaira = (data.amount / 100).toLocaleString();
      const reference = data.reference;

      // Extract Lagos Life Username and Pack from metadata custom_fields
      const fields = data.metadata?.custom_fields || [];
      const usernameField = fields.find((f) => f.variable_name === 'username');
      const packField = fields.find((f) => f.variable_name === 'pack');

      const username = usernameField ? usernameField.value : 'Unknown';
      const pack = packField ? packField.value : 'Unknown Pack';

      const message = [
        `✅ *NEW PAID ORDER — THIRDBONA EXCHANGE*`,
        ``,
        `👤 *Lagos Life Username:* \`${username}\``,
        `📦 *Pack:* ${pack}`,
        `💰 *Amount Paid:* ₦${amountNaira}`,
        `🧾 *Order ID:* \`${reference}\``,
        ``,
        `⚡ _Payment verified by Paystack. Ready to send in-game._`,
      ].join('\n');

      // 3. Send instant alert to your Telegram
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;

      if (botToken && chatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown',
          }),
        });
      }
    }

    // Always respond 200 OK quickly so Paystack marks the webhook delivered
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

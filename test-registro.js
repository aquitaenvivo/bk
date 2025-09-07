const axios = require('axios');
require('dotenv').config();

const webhookUrl = 'https://aquita-whatsapp-bot.onrender.com/webhook';

async function testRegistro() {
  const messages = [
    { body: 'Hola' },
    { body: '1' },
    { body: 'Juan' },
    { body: 'Perez' },
    { body: 'V-12345678' },
    { body: '04121234567' },
    { body: '3' },
    { body: 'https://twitch.tv/aquita' },
    { body: 'Caracas' }
  ];

  for (const msg of messages) {
    try {
      const res = await axios.post(webhookUrl, {
        instanceId: process.env.GREEN_API_ID_INSTANCE,
        sender: '584149577172@c.us',
        body: msg.body
      });
      console.log(`Mensaje: ${msg.body} -> Respuesta: ${res.status}`);
    } catch (error) {
      console.error(`Error con mensaje: ${msg.body}`, error.response?.data || error.message);
    }
  }
}

testRegistro();

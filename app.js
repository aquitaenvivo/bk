const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const bodyParser = require('body-parser');

// Conectar a MongoDB
mongoose.connect('mongodb+srv://dbaquita:dbgemini@aquita.trhtcc4.mongodb.net/dbregistro+api?retryWrites=true&w=majority&appName=aquita')
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// Modelo de Usuario (Registro)
const User = mongoose.model('User', {
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  cedula: { type: String, unique: true, required: true },
  telefono: { type: String, required: true },
  estado: { type: String, default: 'verificado' },
});

// Modelo de Stream (Transmisiones)
const Stream = mongoose.model('Stream', {
  enlace: { type: String, required: true },
  canal: { type: String, required: true },
  ciudad: { type: String, required: true },
  telefono: { type: String, required: true },
  estado: { type: String, default: 'pendiente' }, // pendiente, aprobado, rechazado
});

// Datos de Green API
const ID_INSTANCE = '7105316122';
const API_TOKEN_INSTANCE = 'b6f...bf'; // Reemplaza con tu token real

// Función para enviar WhatsApp usando la API REST de Green API
async function sendWhatsAppConfirmation(phone, message) {
  const url = `https://api.green-api.com/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN_INSTANCE}`;

  const data = {
    chatId: `${phone}@c.us`,
    message: message
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Mensaje enviado:', response.data);
  } catch (error) {
    console.error('❌ Error al enviar mensaje:', error.response?.data || error.message);
  }
}

const app = express();
app.use(bodyParser.json());

// Endpoint para recibir mensajes de WhatsApp
app.post('/webhook', async (req, res) => {
  const message = req.body;
  const from = message.sender; // Número del usuario
  const text = message.body; // Texto del mensaje

  // Si el usuario dice "Hola" o mensaje inicial
  if (text.toLowerCase().includes('hola') || text === '') {
    await sendWhatsAppConfirmation(
      from.replace('@c.us', ''),
      `¡Hola! Bienvenido a AQUITA. ¿En qué puedo ayudarte?\n1️⃣ Registro (usuarios)\n2️⃣ Afiliación (negocios)\n3️⃣ Compartir pantalla de stream\nPor favor, responde con el número de tu opción.`
    );
  }

  // Opción 1: Registro de usuario
  else if (text === '1') {
    await sendWhatsAppConfirmation(
      from.replace('@c.us', ''),
      `Perfecto. Para registrarte, por favor envía tus datos en este formato:\nNombre, Apellido, Cédula, Teléfono\nEjemplo: Juan, Pérez, 12345678, 04141234567`
    );
  }

  // Opción 2: Afiliación de negocio
  else if (text === '2') {
    await sendWhatsAppConfirmation(
      from.replace('@c.us', ''),
      `Perfecto. Para afiliar tu negocio, por favor escribe a nuestro otro número de WhatsApp en formato wa.me:\nhttps://wa.me/584149577176`
    );
  }

  // Opción 3: Compartir pantalla de stream
  else if (text === '3') {
    await sendWhatsAppConfirmation(
      from.replace('@c.us', ''),
      `Perfecto. Para compartir tu stream, por favor envía el enlace de tu transmisión en vivo, el canal stream disponible por el cual quieres transmitir y la ciudad. Nuestro equipo lo revisará y lo agregará a AQUITA+.`
    );
  }

  // Procesar registro de usuario (formato: Nombre, Apellido, Cédula, Teléfono)
  else if (text.includes(',') && text.split(',').length === 4) {
    const [nombre, apellido, cedula, telefono] = text.split(',').map(item => item.trim());

    // Validar cédula con la API
    try {
      const response = await axios.get(`https://api.cedula.com.ve/api/v1`, {
        params: {
          app_id: '1339',
          token: '6a97fc07f52fa8dc487e4d3a4e69f33',
          nacionalidad: 'V',
          cedula: cedula,
        },
      });

      if (response.data.error) {
        await sendWhatsAppConfirmation(from.replace('@c.us', ''), '❌ Cédula inválida o no encontrada.');
        return;
      }

      const apiNombre = response.data.data.primer_nombre;
      const apiApellido = response.data.data.primer_apellido;

      if (apiNombre.toLowerCase().includes(nombre.toLowerCase()) && apiApellido.toLowerCase().includes(apellido.toLowerCase())) {
        const user = new User({ nombre, apellido, cedula, telefono });
        await user.save();
        await sendWhatsAppConfirmation(from.replace('@c.us', ''), `✅ ¡Registro exitoso! Bienvenido, ${nombre}.`);
      } else {
        await sendWhatsAppConfirmation(from.replace('@c.us', ''), '❌ Los datos no coinciden con los registros oficiales.');
      }
    } catch (error) {
      console.error('Error al validar cédula:', error);
      await sendWhatsAppConfirmation(from.replace('@c.us', ''), '❌ Error al validar la cédula. Inténtalo más tarde.');
    }
  }

  // Procesar solicitud de stream (formato: Enlace, Canal, Ciudad)
  else if (text.includes(',') && text.split(',').length === 3) {
    const [enlace, canal, ciudad] = text.split(',').map(item => item.trim());
    const telefonoUsuario = from.replace('@c.us', '').replace('58', '0'); // Formato local

    const stream = new Stream({ enlace, canal, ciudad, telefono: telefonoUsuario });
    await stream.save();
    await sendWhatsAppConfirmation(from.replace('@c.us', ''), `✅ ¡Solicitud recibida! Nuestro equipo revisará tu stream y lo agregará a AQUITA+.`);
  }

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
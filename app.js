const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const bodyParser = require('body-parser');

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// Modelo de Usuario
const User = mongoose.model('User', {
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  cedula: { type: String, unique: true, required: true },
  telefono: { type: String, required: true },
  estado: { type: String, default: 'verificado' },
});

// Modelo de Stream
const Stream = mongoose.model('Stream', {
  enlace: { type: String, required: true },
  ciudad: { type: String, required: true },
  cedula: { type: String, required: true }, // Usamos cédula como identificador único
  estado: { type: String, default: 'pendiente' },
});

// Datos de Green API (usando variables de entorno)
const ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE;
const API_TOKEN_INSTANCE = process.env.GREEN_API_TOKEN_INSTANCE;

// Función para enviar mensajes por WhatsApp
async function sendWhatsAppMessage(phone, message) {
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

// Estado de conversación por usuario (en memoria - en producción usar base de datos)
const userState = new Map();

// Endpoint para registrar usuarios desde admin
app.post('/admin/register-user', async (req, res) => {
  const { nombre, apellido, cedula, telefono } = req.body;
  const token = req.headers['x-api-key'];

  if (!token || token !== 'tu_token_secreto_admin') {
    return res.status(401).send('Acceso denegado');
  }

  try {
    const response = await axios.get(`https://api.cedula.com.ve/api/v1`, {
      params: {
        app_id: '1339',
        token: '6a97ffc07f52fa8dc487e4d3a4e69f33',
        nacionalidad: 'V',
        cedula: cedula,
      },
    });

    if (response.data.error) {
      return res.status(400).send('❌ Cédula inválida o no encontrada.');
    }

    const apiNombre = response.data.data.primer_nombre;
    const apiApellido = response.data.data.primer_apellido;

    if (apiNombre.toLowerCase().includes(nombre.toLowerCase()) && apiApellido.toLowerCase().includes(apellido.toLowerCase())) {
      const user = new User({ nombre, apellido, cedula, telefono });
      await user.save();
      res.send('✅ Usuario registrado exitosamente.');
    } else {
      res.status(400).send('❌ Los datos no coinciden con los registros oficiales.');
    }
  } catch (error) {
    console.error('Error al validar cédula:', error);
    res.status(500).send('❌ Error al validar la cédula. Inténtalo más tarde.');
  }
});

// Endpoint para recibir mensajes de WhatsApp
app.post('/webhook', async (req, res) => {
  const message = req.body;
  const from = message.sender;
  const text = message.body.trim();

  // Extraer número sin @c.us
  const phoneNumber = from.replace('@c.us', '').replace('58', '0');

  // Inicializar estado del usuario si no existe
  if (!userState.has(from)) {
    userState.set(from, { step: 'menu' }); // menu, nombre, apellido, cedula, telefono
  }

  const state = userState.get(from);

  if (text.toLowerCase().includes('hola') || text === '') {
    state.step = 'menu';
    await sendWhatsAppMessage(phoneNumber, `¡Hola! Bienvenido a AQUITA. ¿En qué puedo ayudarte?\n1️⃣ Registro (usuarios)\n2️⃣ Afiliación (negocios)\n3️⃣ Compartir pantalla de stream\nPor favor, responde con el número de tu opción.`);
  }

  else if (text === '1') {
    state.step = 'nombre';
    await sendWhatsAppMessage(phoneNumber, '¿Cuál es tu nombre?');
  }

  else if (state.step === 'nombre') {
    state.nombre = text;
    state.step = 'apellido';
    await sendWhatsAppMessage(phoneNumber, '¿Cuál es tu apellido?');
  }

  else if (state.step === 'apellido') {
    state.apellido = text;
    state.step = 'cedula';
    await sendWhatsAppMessage(phoneNumber, 'Por favor, envía tu número de cédula (ej: V-12345678)');
  }

  else if (state.step === 'cedula') {
    const cedulaRegex = /^([VE])-(\d{8})$/i;
    const match = text.match(cedulaRegex);

    if (!match) {
      await sendWhatsAppMessage(phoneNumber, '❌ Formato de cédula inválido. Usa V-12345678 o E-12345678.');
      return;
    }

    const [_, nacionalidad, numCedula] = match;
    const fullCedula = `${nacionalidad}-${numCedula}`;

    state.cedula = fullCedula;
    state.step = 'telefono';
    await sendWhatsAppMessage(phoneNumber, 'Por favor, envía tu número de teléfono (ej: 04121234567)');
  }

  else if (state.step === 'telefono') {
    const telefonoRegex = /^\d{11}$/; // 04121234567
    if (!telefonoRegex.test(text)) {
      await sendWhatsAppMessage(phoneNumber, '❌ Formato de teléfono inválido. Usa 04121234567.');
      return;
    }

    const user = new User({
      nombre: state.nombre,
      apellido: state.apellido,
      cedula: state.cedula,
      telefono: text
    });

    try {
      // Validar cédula con API externa
      const response = await axios.get(`https://api.cedula.com.ve/api/v1`, {
        params: {
          app_id: '1339',
          token: '6a97ffc07f52fa8dc487e4d3a4e69f33',
          nacionalidad: 'V',
          cedula: state.cedula.split('-')[1],
        },
      });

      if (response.data.error) {
        if (response.data.error.includes('rate limit')) {
          await sendWhatsAppMessage(phoneNumber, '⚠️ Límite de solicitudes alcanzado. Por favor, intenta nuevamente en 2 horas.');
        } else {
          await sendWhatsAppMessage(phoneNumber, '❌ Cédula inválida o no encontrada.');
        }
        return;
      }

      const apiNombre = response.data.data.primer_nombre;
      const apiApellido = response.data.data.primer_apellido;

      if (apiNombre.toLowerCase().includes(state.nombre.toLowerCase()) && apiApellido.toLowerCase().includes(state.apellido.toLowerCase())) {
        await user.save();
        await sendWhatsAppMessage(phoneNumber, `✅ ¡Registro exitoso! Bienvenido, ${state.nombre}.`);
      } else {
        await sendWhatsAppMessage(phoneNumber, '❌ Los datos no coinciden con los registros oficiales.');
      }
    } catch (error) {
      console.error('Error al validar cédula:', error);
      await sendWhatsAppMessage(phoneNumber, '❌ Error al validar la cédula. Inténtalo más tarde.');
    }

    // Reiniciar estado
    userState.delete(from);
  }

  else if (text === '2') {
    await sendWhatsAppMessage(phoneNumber, `Perfecto. Para afiliar tu negocio, por favor escribe a nuestro otro número de WhatsApp en formato wa.me:\nhttps://wa.me/584149577176`);
  }

  else if (text === '3') {
    state.step = 'stream-enlace';
    await sendWhatsAppMessage(phoneNumber, 'Por favor, envía el enlace de tu transmisión en vivo (ej: https://example.com/live)');
  }

  else if (state.step === 'stream-enlace') {
    const enlace = text;
    if (!enlace.startsWith('http')) {
      await sendWhatsAppMessage(phoneNumber, '❌ Enlace inválido. Debe comenzar con http:// o https://');
      return;
    }

    state.step = 'stream-ciudad';
    await sendWhatsAppMessage(phoneNumber, '¿En qué ciudad se encuentra tu transmisión?');
  }

  else if (state.step === 'stream-ciudad') {
    const ciudad = text;
    const stream = new Stream({
      enlace: state.streamEnlace,
      ciudad: ciudad,
      cedula: state.cedula || phoneNumber // Si no tiene cédula, usa el número
    });

    try {
      await stream.save();
      await sendWhatsAppMessage(phoneNumber, `✅ ¡Solicitud recibida! Nuestro equipo revisará tu stream y lo agregará a AQUITA+.`);
    } catch (error) {
      console.error('Error al guardar stream:', error);
      await sendWhatsAppMessage(phoneNumber, '❌ Error al guardar la solicitud. Inténtalo más tarde.');
    }

    // Reiniciar estado
    userState.delete(from);
  }

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

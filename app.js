// app.js
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const bodyParser = require('body-parser');

// --- CONFIGURACIÓN ---
// Es crucial que 'app' se defina inmediatamente después de las importaciones
const app = express();
app.use(bodyParser.json());

// Puerto (usado por Render)
const PORT = process.env.PORT || 10000; // Render usa 10000 por defecto

// Tu token secreto para el endpoint admin (debe estar en Render ENV)
const ADMIN_TOKEN = process.env.ADMIN_API_KEY;

// Validación de variables críticas de entorno
if (!ADMIN_TOKEN) {
    console.error("❌ FALTA LA VARIABLE DE ENTORNO: ADMIN_API_KEY");
    // process.exit(1); // Opcional: detener el inicio si es crítica
}

// Conectar a MongoDB (usando variable de entorno)
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Conectado a MongoDB'))
    .catch(err => {
        console.error('❌ Error al conectar a MongoDB:', err);
        // process.exit(1); // Salir si no se puede conectar a la base de datos
    });

// --- MODELOS MONGOOSE ---

// Modelo de Usuario (Registro)
const UserSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    apellido: { type: String, required: true },
    cedula: { type: String, unique: true, required: true, index: true }, // Índice para búsquedas rápidas
    telefono: { type: String, required: true },
    estado: { type: String, default: 'verificado' },
}, { timestamps: true }); // Añade createdAt y updatedAt

const User = mongoose.model('User', UserSchema);

// Modelo de Stream (Transmisiones)
// Asumimos que el usuario ya está registrado, por lo que usamos cédula como identificador
const StreamSchema = new mongoose.Schema({
    enlace: { type: String, required: true },
    ciudad: { type: String, required: true },
    cedulaUsuario: { type: String, required: true }, // Referencia a la cédula del usuario
    estado: { type: String, default: 'pendiente' },
}, { timestamps: true });

const Stream = mongoose.model('Stream', StreamSchema);

// --- CONFIGURACIÓN DE GREEN API ---
const ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE;
const API_TOKEN_INSTANCE = process.env.GREEN_API_TOKEN_INSTANCE;

if (!ID_INSTANCE || !API_TOKEN_INSTANCE) {
    console.error("❌ FALTAN LAS VARIABLES DE ENTORNO: GREEN_API_ID_INSTANCE o GREEN_API_TOKEN_INSTANCE");
    // process.exit(1);
}

// --- FUNCIONES AUXILIARES ---

// Función para enviar mensajes por WhatsApp usando la API REST de Green API
async function sendWhatsAppMessage(phone, message) {
    // ✅ Corrección: Eliminar espacio extra en la URL
    const url = `https://api.green-api.com/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN_INSTANCE}`;

    // Asegurarse de que el número tenga el formato correcto para Green API
    const cleanPhone = phone.replace('@c.us', '').replace('+', '');
    const chatId = `${cleanPhone}@c.us`;

    const data = {
        chatId: chatId,
        message: message
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000 // Timeout de 15 segundos para llamadas externas
        });
        console.log('✅ Mensaje enviado a', chatId, ':', response.data?.id || 'ID no disponible');
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Error al enviar mensaje a', chatId, ':', error.response?.data || error.message);
        return { success: false, error: error.message };
    }
}

// Estado de conversación por usuario (en memoria)
// ⚠️ Para producción, usar una base de datos como Redis sería más robusto
const userConversationState = new Map();

// --- ENDPOINTS ---

// Endpoint para registrar usuarios desde admin (protegido por token)
app.post('/admin/register-user', async (req, res) => {
    const { nombre, apellido, cedula, telefono } = req.body;
    const token = req.headers['x-api-key'];

    // Verificar token de autenticación
    if (!token || token !== ADMIN_TOKEN) {
        console.warn('⚠️ Intento de acceso no autorizado al endpoint /admin/register-user');
        return res.status(401).send('❌ Acceso denegado. Token inválido.');
    }

    // Validación básica de datos de entrada
    if (!nombre || !apellido || !cedula || !telefono) {
        return res.status(400).send('❌ Faltan datos: nombre, apellido, cédula y teléfono son obligatorios.');
    }

    try {
        // --- Validación de Cédula ---
        // Asumimos formato V-12345678 o E-12345678
        const cedulaRegex = /^([VE])-(\d{8})$/i;
        const match = cedula.match(cedulaRegex);

        if (!match) {
            await sendWhatsAppMessage(telefono, '❌ Formato de cédula inválido para registro admin. Usa V-12345678 o E-12345678.');
            return res.status(400).send('❌ Formato de cédula inválido. Usa V-12345678 o E-12345678.');
        }

        const nacionalidad = match[1].toUpperCase();
        const numCedula = match[2];

        console.log(`🔍 Validando cédula ${nacionalidad}-${numCedula}...`);
        // ✅ Corrección: Eliminar espacio extra en la URL
        const response = await axios.get(`https://api.cedula.com.ve/api/v1`, {
            params: {
                app_id: '1339', // Considerar usar variables de entorno también para estos
                token: '6a97ffc07f52fa8dc487e4d3a4e69f33',
                nacionalidad: nacionalidad,
                cedula: numCedula,
            },
            timeout: 15000 // Timeout de 15 segundos
        });

        console.log('📄 Respuesta de API de cédula (admin):', JSON.stringify(response.data, null, 2));

        // Manejo de errores de la API de cédula
        if (response.data.error) {
            console.error('❌ Error de la API de cédula (admin):', response.data.error);
            if (response.data.error.toLowerCase().includes('rate limit')) {
                await sendWhatsAppMessage(telefono, '⚠️ Límite de solicitudes a la API de cédula alcanzado. Por favor, inténtalo más tarde.');
                return res.status(429).send('⚠️ Límite de solicitudes a la API de cédula alcanzado. Por favor, inténtalo más tarde.');
            } else {
                await sendWhatsAppMessage(telefono, `❌ La cédula ${cedula} no es válida o no se encontró en los registros oficiales.`);
                return res.status(400).send(`❌ La cédula ${cedula} no es válida o no se encontró.`);
            }
        }

        // Verificar estructura de la respuesta
        if (!response.data.data || !response.data.data.primer_nombre || !response.data.data.primer_apellido) {
            console.error('❌ Estructura de respuesta inesperada de la API de cédula (admin).');
            await sendWhatsAppMessage(telefono, '❌ Error inesperado al validar la cédula. Inténtalo más tarde.');
            return res.status(500).send('❌ Error inesperado al validar la cédula.');
        }

        const apiNombre = response.data.data.primer_nombre;
        const apiApellido = response.data.data.primer_apellido;

        // Comparar nombres (búsqueda parcial para mayor flexibilidad)
        if (!apiNombre.toLowerCase().includes(nombre.toLowerCase()) || !apiApellido.toLowerCase().includes(apellido.toLowerCase())) {
            await sendWhatsAppMessage(telefono, `❌ Los datos proporcionados (${nombre} ${apellido}) no coinciden con los registros oficiales para la cédula ${cedula}.`);
            return res.status(400).send('❌ Los datos no coinciden con los registros oficiales.');
        }

        // --- Guardar en MongoDB ---
        const newUser = new User({ nombre, apellido, cedula, telefono });
        await newUser.save();
        console.log(`✅ Usuario ${nombre} ${apellido} (${cedula}) registrado exitosamente vía admin.`);

        // Notificar por WhatsApp (opcional)
        // await sendWhatsAppMessage(telefono, `✅ ¡Registro exitoso vía admin! Bienvenido, ${nombre} ${apellido}.`);

        res.status(201).send(`✅ Usuario ${nombre} ${apellido} (${cedula}) registrado exitosamente.`);
    } catch (error) {
        if (error.code === 11000) { // Error de clave duplicada de MongoDB
            console.warn(`⚠️ Intento de registro duplicado para la cédula ${cedula} (admin).`);
            await sendWhatsAppMessage(telefono, `❌ La cédula ${cedula} ya está registrada en el sistema.`);
            return res.status(409).send(`❌ La cédula ${cedula} ya está registrada.`);
        }
        console.error('❌ Error al registrar usuario vía admin:', error);
        res.status(500).send('❌ Error interno del servidor al procesar el registro.');
    }
});

// Endpoint principal para recibir mensajes de WhatsApp
app.post('/webhook', async (req, res) => {
    try {
        const message = req.body;
        console.log("📥 Mensaje recibido en webhook:", JSON.stringify(message, null, 2));

        // Validación básica del mensaje
        if (!message || !message.sender || message.sender === 'status@broadcast') {
            console.log("ℹ️ Mensaje de estado o inválido recibido, ignorando.");
            return res.status(200).send('OK'); // Responder OK para evitar reintentos de Green API
        }

        const from = message.sender; // Ej: "584123456789@c.us"
        const text = (message.body || '').trim(); // Manejar posibles mensajes sin body

        // Extraer número de teléfono limpio (ej: "04123456789")
        const phoneNumberClean = from.replace('@c.us', '').startsWith('58') ? from.replace('@c.us', '').replace('58', '0') : from.replace('@c.us', '');
        const fullPhoneNumber = from.replace('@c.us', ''); // Para usar con Green API

        // --- Manejo del Estado de Conversación ---
        let state = userConversationState.get(from);
        if (!state) {
            state = { step: 'menu' }; // Inicializar estado si no existe
            userConversationState.set(from, state);
        }

        console.log(`💬 Usuario ${fullPhoneNumber} en paso: ${state.step}. Mensaje: "${text}"`);

        // --- LÓGICA DE FLUJO DE CONVERSACIÓN ---

        // 1. Mensaje de bienvenida o reseteo
        if (text.toLowerCase().includes('hola') || text === '') {
            state.step = 'menu';
            await sendWhatsAppMessage(fullPhoneNumber, `👋 ¡Hola! Bienvenido a *AQUITA*.\n¿En qué puedo ayudarte?\n\n1️⃣ *Registro* (usuarios)\n2️⃣ *Afiliación* (negocios)\n3️⃣ *Compartir pantalla* de stream\n\nPor favor, responde con el *número* de tu opción.`);

            // 2. Opción de Registro
        } else if (text === '1') {
            state.step = 'nombre';
            await sendWhatsAppMessage(fullPhoneNumber, `📝 *Registro de Usuario*\nPor favor, dime tu *nombre*:`);

            // 3. Opción de Afiliación
        } else if (text === '2') {
            await sendWhatsAppMessage(fullPhoneNumber, `🏪 *Afiliación de Negocios*\nPara afiliar tu negocio, escríbenos al siguiente número:\n🔗 https://wa.me/584149577176`);

            // 4. Opción de Compartir Stream
        } else if (text === '3') {
            state.step = 'stream_enlace';
            await sendWhatsAppMessage(fullPhoneNumber, `📺 *Compartir Pantalla de Stream*\nPor favor, envíame el *enlace* de tu transmisión en vivo (ej: https://twitch.tv/tunombre):`);

            // --- FLUJO DE REGISTRO (pasos secuenciales) ---
        } else if (state.step === 'nombre') {
            if (text.length < 2) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ El nombre debe tener al menos 2 caracteres. Por favor, inténtalo de nuevo:`);
                return res.status(200).send('OK');
            }
            state.nombre = text;
            state.step = 'apellido';
            await sendWhatsAppMessage(fullPhoneNumber, `Apellido:`);

        } else if (state.step === 'apellido') {
            if (text.length < 2) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ El apellido debe tener al menos 2 caracteres. Por favor, inténtalo de nuevo:`);
                return res.status(200).send('OK');
            }
            state.apellido = text;
            state.step = 'cedula';
            await sendWhatsAppMessage(fullPhoneNumber, `Cédula (formato: V-12345678):`);

        } else if (state.step === 'cedula') {
            const cedulaRegex = /^([VE])-(\d{8})$/i;
            const match = text.match(cedulaRegex);

            if (!match) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ Formato inválido. Por favor, usa el formato *V-12345678* o *E-12345678*:`);
                return res.status(200).send('OK');
            }

            const nacionalidad = match[1].toUpperCase();
            const numCedula = match[2];
            const fullCedula = `${nacionalidad}-${numCedula}`;

            state.cedula = fullCedula;
            state.step = 'telefono';
            await sendWhatsAppMessage(fullPhoneNumber, `Teléfono (formato: 04123456789):`);

        } else if (state.step === 'telefono') {
            const telefonoRegex = /^0\d{10}$/; // Debe empezar con 0 y tener 11 dígitos
            if (!telefonoRegex.test(text)) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ Formato inválido. Por favor, usa el formato *04123456789*:`);
                return res.status(200).send('OK');
            }

            state.telefono = text;

            // --- Validación Final y Registro ---
            try {
                console.log(`🔍 Validando cédula ${state.cedula} para ${state.nombre} ${state.apellido}...`);
                const cedulaParts = state.cedula.split('-');
                // ✅ Corrección: Eliminar espacio extra en la URL
                const response = await axios.get(`https://api.cedula.com.ve/api/v1`, {
                    params: {
                        app_id: '1339',
                        token: '6a97ffc07f52fa8dc487e4d3a4e69f33',
                        nacionalidad: cedulaParts[0],
                        cedula: cedulaParts[1],
                    },
                    timeout: 15000 // Timeout de 15 segundos
                });

                console.log('📄 Respuesta de API de cédula (webhook):', JSON.stringify(response.data, null, 2));

                if (response.data.error) {
                    console.error('❌ Error de la API de cédula (webhook):', response.data.error);
                    if (response.data.error.toLowerCase().includes('rate limit')) {
                        await sendWhatsAppMessage(fullPhoneNumber, '⚠️ *Límite de solicitudes alcanzado*. Por favor, intenta nuevamente en 2 horas.');
                    } else {
                        await sendWhatsAppMessage(fullPhoneNumber, `❌ *Cédula no válida o no encontrada* (${state.cedula}).`);
                    }
                    userConversationState.delete(from); // Reiniciar estado
                    return res.status(200).send('OK');
                }

                if (!response.data.data || !response.data.data.primer_nombre || !response.data.data.primer_apellido) {
                    console.error('❌ Estructura de respuesta inesperada de la API de cédula (webhook).');
                    await sendWhatsAppMessage(fullPhoneNumber, '❌ *Error inesperado al validar la cédula*. Inténtalo más tarde.');
                    userConversationState.delete(from);
                    return res.status(200).send('OK');
                }

                const apiNombre = response.data.data.primer_nombre;
                const apiApellido = response.data.data.primer_apellido;

                if (!apiNombre.toLowerCase().includes(state.nombre.toLowerCase()) || !apiApellido.toLowerCase().includes(state.apellido.toLowerCase())) {
                    await sendWhatsAppMessage(fullPhoneNumber, `❌ *Los datos no coinciden* con los registros oficiales.\nIngresaste: *${state.nombre} ${state.apellido}*\nRegistro oficial: *${apiNombre} ${apiApellido}*`);
                    userConversationState.delete(from);
                    return res.status(200).send('OK');
                }

                // Guardar en MongoDB
                const newUser = new User({
                    nombre: state.nombre,
                    apellido: state.apellido,
                    cedula: state.cedula,
                    telefono: state.telefono
                });

                await newUser.save();
                console.log(`✅ Usuario ${state.nombre} ${state.apellido} (${state.cedula}) registrado vía WhatsApp.`);
                await sendWhatsAppMessage(fullPhoneNumber, `🎉 *¡Registro exitoso!*\nBienvenido, *${state.nombre} ${state.apellido}*.\nTu cédula *${state.cedula}* ha sido verificada.`);

            } catch (dbError) {
                if (dbError.code === 11000) {
                    console.warn(`⚠️ Intento de registro duplicado para la cédula ${state.cedula} vía WhatsApp.`);
                    await sendWhatsAppMessage(fullPhoneNumber, `❌ *La cédula ${state.cedula} ya está registrada* en nuestro sistema.`);
                } else {
                    console.error('❌ Error al guardar usuario en MongoDB (webhook):', dbError);
                    await sendWhatsAppMessage(fullPhoneNumber, '❌ *Error al guardar el registro*. Por favor, inténtalo más tarde.');
                }
            } finally {
                // Reiniciar estado de conversación
                userConversationState.delete(from);
            }

            // --- FLUJO DE STREAM (pasos secuenciales) ---
        } else if (state.step === 'stream_enlace') {
            if (!text.startsWith('http')) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ *Enlace inválido*. Debe comenzar con *http://* o *https://*. Por favor, inténtalo de nuevo:`);
                return res.status(200).send('OK');
            }
            state.stream_enlace = text;
            state.step = 'stream_ciudad';
            await sendWhatsAppMessage(fullPhoneNumber, `Ciudad donde se encuentra la transmisión:`);

        } else if (state.step === 'stream_ciudad') {
            if (text.length < 3) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ El nombre de la ciudad debe tener al menos 3 caracteres. Por favor, inténtalo de nuevo:`);
                return res.status(200).send('OK');
            }
            state.stream_ciudad = text;

            // Solicitar cédula del usuario que comparte el stream
            state.step = 'stream_cedula';
            await sendWhatsAppMessage(fullPhoneNumber, `Para finalizar, por favor envíame tu *número de cédula* (formato: V-12345678) para asociar el stream a tu cuenta:`);

        } else if (state.step === 'stream_cedula') {
            const cedulaRegex = /^([VE])-(\d{8})$/i;
            const match = text.match(cedulaRegex);

            if (!match) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ Formato inválido. Por favor, usa el formato *V-12345678* o *E-12345678*:`);
                return res.status(200).send('OK');
            }

            const nacionalidad = match[1].toUpperCase();
            const numCedula = match[2];
            const fullCedula = `${nacionalidad}-${numCedula}`;

            // Verificar si el usuario con esa cédula existe
            const userExists = await User.findOne({ cedula: fullCedula });
            if (!userExists) {
                await sendWhatsAppMessage(fullPhoneNumber, `❌ *No se encontró un usuario registrado* con la cédula *${fullCedula}*. Por favor, regístrate primero usando la opción 1.`);
                userConversationState.delete(from); // Reiniciar estado
                return res.status(200).send('OK');
            }

            // Guardar stream en MongoDB
            try {
                const newStream = new Stream({
                    enlace: state.stream_enlace,
                    ciudad: state.stream_ciudad,
                    cedulaUsuario: fullCedula // Asociar al usuario
                });

                await newStream.save();
                console.log(`✅ Solicitud de stream recibida de ${fullCedula} (${state.stream_enlace}) para ${state.stream_ciudad}.`);
                await sendWhatsAppMessage(fullPhoneNumber, `✅ *¡Solicitud recibida!*\nNuestro equipo revisará tu stream (*${state.stream_enlace}*) en *${state.stream_ciudad}* y lo agregará a *AQUITA+* pronto.`);

            } catch (streamError) {
                console.error('❌ Error al guardar solicitud de stream:', streamError);
                await sendWhatsAppMessage(fullPhoneNumber, '❌ *Error al guardar la solicitud*. Por favor, inténtalo más tarde.');
            } finally {
                userConversationState.delete(from); // Reiniciar estado
            }

            // --- Manejo de entradas no reconocidas ---
        } else {
            console.log(`❓ Entrada no reconocida de ${fullPhoneNumber}: "${text}". Estado actual: ${state.step}`);
            // Opcional: Reiniciar o pedir que elija una opción
            await sendWhatsAppMessage(fullPhoneNumber, `❓ No entendí tu mensaje.\nPor favor, elige una opción:\n1️⃣ Registro\n2️⃣ Afiliación\n3️⃣ Compartir Stream`);
            // O reiniciar el flujo:
            // state.step = 'menu';
            // await sendWhatsAppMessage(fullPhoneNumber, `...mensaje de menú...`);
        }

    } catch (error) {
        console.error('💥 Error crítico en el webhook:', error);
        // No enviar mensaje al usuario por un error interno del servidor
        // Pero es importante responder a Green API para que no reenvíe el mensaje
    }

    res.status(200).send('OK');
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, '0.0.0.0', () => { // Bind a 0.0.0.0 para Render
    console.log(`🚀 Servidor AQUITA WhatsApp Bot corriendo en http://0.0.0.0:${PORT}`);
});

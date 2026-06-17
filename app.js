// ============================================================
// 🔥 CONFIGURACIÓN DE FIREBASE (proyecto "mibar-52b4d")
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyC-W7aK7ydDVZrC1TkwbQqee9ca9OCbNLM",
    authDomain: "mibar-52b4d.firebaseapp.com",
    databaseURL: "https://mibar-52b4d-default-rtdb.firebaseio.com",
    projectId: "mibar-52b4d",
    storageBucket: "mibar-52b4d.firebasestorage.app",
    messagingSenderId: "256299170602",
    appId: "1:256299170602:web:37c53d203adaace0d83c53"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const messaging = firebase.messaging();

// ============================================================
// ESTADO GLOBAL
// ============================================================
let mesas = [];
let pedidos = [];
let nextPedidoId = 1;
let eventosOcupacion = [];
let menuDia = [];

let currentCarrito = [];
let currentMeseroNombre = "Carlos";
let currentRole = "host";
let swRegistration = null;
let fcmToken = null;

// ============================================================
// SERVICE WORKER INTERNO (para notificaciones desde la app)
// ============================================================
async function registerInternalSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const swCode = `
            self.addEventListener('install', e => self.skipWaiting());
            self.addEventListener('activate', e => e.waitUntil(clients.claim()));
            self.addEventListener('message', event => {
                if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
                    const { title, body, tag } = event.data;
                    self.registration.showNotification(title, {
                        body,
                        icon: '/mibar/icon-192.png',
                        badge: '/mibar/icon-192.png',
                        tag: tag || 'resto-push',
                        vibrate: [200,100,200],
                        requireInteraction: true
                    });
                }
            });
        `;
        const blob = new Blob([swCode], { type: 'application/javascript' });
        const swUrl = URL.createObjectURL(blob);
        const registration = await navigator.serviceWorker.register(swUrl);
        URL.revokeObjectURL(swUrl);
        swRegistration = registration;
    } catch (err) {
        console.error('Error registrando SW interno:', err);
    }
}

// ============================================================
// FCM (NOTIFICACIONES PUSH NATIVAS)
// ============================================================
async function registerFCMSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const registration = await navigator.serviceWorker.register('/mibar/firebase-messaging-sw.js');
        console.log('Service Worker de FCM registrado:', registration);
        await messaging.useServiceWorker(registration);
        await requestFCMToken();
    } catch (err) {
        console.error('Error registrando SW de FCM:', err);
    }
}

async function requestFCMToken() {
    try {
        if (Notification.permission !== 'granted') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                console.warn('Permiso de notificaciones denegado');
                return;
            }
        }

        const token = await messaging.getToken({
            vapidKey: 'BL0KBt0n9D-HH_Xh9qNSTuG6z3MvnKt_IBlRlzvLQ9aePx6AqN5os-GL6J-IiRKG-n7p4BSW26MLR5oixQjNW8I'
        });
        console.log('Token FCM:', token);
        fcmToken = token;

        db.ref('fcmTokens').push({
            token: token,
            userAgent: navigator.userAgent,
            timestamp: Date.now()
        });

        document.getElementById('requestPermisoBtn').style.display = 'none';
        mostrarToast('🔔 Notificaciones push activadas', ['host','mesero','cocina']);
        return token;
    } catch (err) {
        console.error('Error obteniendo token FCM:', err);
        mostrarToast('❌ Error al activar notificaciones', ['host','mesero','cocina']);
    }
}

// Manejar mensajes en primer plano (cuando la app está abierta)
messaging.onMessage((payload) => {
    console.log('Mensaje en primer plano:', payload);
    const title = payload.notification?.title || 'RestoPWA';
    const body = payload.notification?.body || 'Evento importante';
    mostrarToast(`🔔 ${title}: ${body}`, ['host','mesero','cocina']);
});

// ============================================================
// FUNCIONES DE SINCRONIZACIÓN CON FIREBASE
// ============================================================
function guardarDatos() {
    const data = { mesas, pedidos, nextPedidoId, eventosOcupacion: eventosOcupacion.slice(-6), menuDia };
    db.ref('restoData').set(data).catch(err => console.error('Error guardando en Firebase:', err));
}

function cargarDatosDesdeFirebase(snapshot) {
    const data = snapshot.val();
    if (data) {
        mesas = data.mesas || [];
        pedidos = data.pedidos || [];
        nextPedidoId = data.nextPedidoId || 1;
        eventosOcupacion = data.eventosOcupacion || [];
        menuDia = data.menuDia || [];
        if (mesas.length === 0) {
            const capacidades = [2, 2, 1, 1, 1, 1];
            for (let i = 0; i < 6; i++) {
                mesas.push({
                    id: i + 1,
                    numero: i + 1,
                    estado: 'disponible',
                    capacidad: capacidades[i]
                });
            }
            guardarDatos();
        } else {
            mesas.forEach(m => {
                if (!m.capacidad) m.capacidad = 1;
            });
        }
        if (menuDia.length > 0 && !menuDia[0].id) {
            menuDia = menuDia.map((item, idx) => ({ ...item, id: Date.now() + idx }));
            guardarDatos();
        }
        actualizarVistaActual();
    } else {
        const capacidades = [2, 2, 1, 1, 1, 1];
        for (let i = 0; i < 6; i++) {
            mesas.push({
                id: i + 1,
                numero: i + 1,
                estado: 'disponible',
                capacidad: capacidades[i]
            });
        }
        guardarDatos();
        actualizarVistaActual();
    }
}

function escucharCambios() {
    db.ref('restoData').on('value', (snapshot) => {
        cargarDatosDesdeFirebase(snapshot);
    });
}

function mostrarToast(mensaje, rolesPermitidos = ["host","mesero","cocina"]) {
    if (!rolesPermitidos.includes(currentRole)) return;
    const toast = document.createElement("div");
    toast.className = "notificacion-toast";
    toast.innerText = mensaje;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// ACCIONES DE NEGOCIO
// ============================================================
function cambiarEstadoMesa(id) {
    const mesa = mesas.find(m => m.id === id);
    if (!mesa) return false;
    if (mesa.estado === 'disponible') {
        mesa.estado = 'reservada';
        const msg = `🟡 Mesa ${mesa.numero} RESERVADA.`;
        eventosOcupacion.unshift(msg);
        if (eventosOcupacion.length > 6) eventosOcupacion.pop();
        guardarDatos();
        mostrarToast(msg, ["host"]);
        enviarNotificacionFCM('Mesa reservada', `Mesa ${mesa.numero} ha sido reservada.`);
    } else if (mesa.estado === 'reservada') {
        mesa.estado = 'ocupada';
        const msg = `🔴 Mesa ${mesa.numero} OCUPADA.`;
        eventosOcupacion.unshift(msg);
        if (eventosOcupacion.length > 6) eventosOcupacion.pop();
        guardarDatos();
        mostrarToast(msg, ["host"]);
        enviarNotificacionFCM('Mesa ocupada', `Mesa ${mesa.numero} ha sido ocupada.`);
    } else if (mesa.estado === 'ocupada') {
        const pedidosActivos = pedidos.filter(p => p.mesaId === id && (p.estado === "pendiente" || p.estado === "listo"));
        if (pedidosActivos.length > 0) {
            const ids = pedidosActivos.map(p => `#${p.id}`).join(', ');
            mostrarToast(`❌ Mesa ${mesa.numero}: tiene pedidos sin entregar (${ids}). No se puede liberar.`, ["host"]);
            console.warn(`Pedidos activos en mesa ${mesa.numero}:`, pedidosActivos);
            return false;
        }
        mesa.estado = 'disponible';
        const msg = `🟢 Mesa ${mesa.numero} disponible.`;
        eventosOcupacion.unshift(msg);
        if (eventosOcupacion.length > 6) eventosOcupacion.pop();
        guardarDatos();
        mostrarToast(msg, ["host"]);
        enviarNotificacionFCM('Mesa disponible', `Mesa ${mesa.numero} ahora está libre.`);
    }
    return true;
}

// Función para enviar notificaciones push nativas a través de FCM
async function enviarNotificacionFCM(title, body) {
    if (!fcmToken) {
        console.warn('No hay token FCM para enviar notificación');
        return;
    }
    console.log(`📨 Notificación FCM: ${title} - ${body}`);
    // Aquí se integraría el envío real con un servidor.
}

function liberarMesa(id) {
    const mesa = mesas.find(m => m.id === id);
    if (!mesa || mesa.estado === 'disponible') return false;
    const pedidosActivos = pedidos.filter(p => p.mesaId === id && (p.estado === "pendiente" || p.estado === "listo"));
    if (pedidosActivos.length > 0) {
        const ids = pedidosActivos.map(p => `#${p.id}`).join(', ');
        mostrarToast(`❌ Mesa ${mesa.numero}: tiene pedidos sin entregar (${ids}). No se puede liberar.`, ["host"]);
        console.warn(`Pedidos activos en mesa ${mesa.numero}:`, pedidosActivos);
        return false;
    }
    mesa.estado = 'disponible';
    const msg = `🟢 Mesa ${mesa.numero} disponible.`;
    eventosOcupacion.unshift(msg);
    if (eventosOcupacion.length > 6) eventosOcupacion.pop();
    guardarDatos();
    mostrarToast(msg, ["host"]);
    enviarNotificacionFCM('Mesa disponible', `Mesa ${mesa.numero} ahora está libre.`);
    return true;
}

// === NUEVA FUNCIÓN: Editar capacidad con doble clic ===
function editarCapacidadMesa(id) {
    const mesa = mesas.find(m => m.id === id);
    if (!mesa) return;
    const nuevaCap = prompt(`✏️ Ingresa el número de sillas para Mesa ${mesa.numero}:`, mesa.capacidad);
    if (nuevaCap !== null) {
        const num = parseInt(nuevaCap);
        if (!isNaN(num) && num > 0) {
            mesa.capacidad = num;
            guardarDatos();
            actualizarVistaActual();
            mostrarToast(`✅ Capacidad de Mesa ${mesa.numero} actualizada a ${mesa.capacidad} sillas`, ["host"]);
        } else {
            mostrarToast('❌ Ingresa un número válido (mayor que 0).', ["host"]);
        }
    }
}

function agregarPedido(mesaId, itemsSeleccionados, waiterName) {
    if (!waiterName.trim()) { mostrarToast("Ingresa nombre del mesero", ["mesero"]); return false; }
    const mesa = mesas.find(m => m.id === mesaId);
    if (!mesa || mesa.estado !== "ocupada") { mostrarToast("Mesa debe estar ocupada", ["mesero"]); return false; }
    if (itemsSeleccionados.length === 0) { mostrarToast("Agrega productos", ["mesero"]); return false; }
    const nuevoPedido = { id: nextPedidoId++, mesaId, items: [...itemsSeleccionados], estado: "pendiente", waiterName: waiterName.trim(), timestamp: Date.now() };
    pedidos.push(nuevoPedido);
    guardarDatos();
    mostrarToast(`📝 Pedido #${nuevoPedido.id} enviado a cocina (Mesa ${mesa.numero})`, ["mesero"]);
    enviarNotificacionFCM('Nuevo pedido en cocina', `Mesa ${mesa.numero} - Pedido #${nuevoPedido.id} por ${waiterName}`);
    return true;
}

function liberarPedidoCocina(pedidoId) {
    const pedido = pedidos.find(p => p.id === pedidoId);
    if (!pedido || pedido.estado !== "pendiente") return false;
    pedido.estado = "listo";
    guardarDatos();
    const mesaNum = mesas.find(m => m.id === pedido.mesaId)?.numero || "?";
    if (currentRole === "cocina") mostrarToast(`✅ Pedido #${pedido.id} listo`, ["cocina"]);
    enviarNotificacionFCM(`Pedido listo #${pedido.id}`, `Mesa ${mesaNum} - Listo para servir. Mesero: ${pedido.waiterName}`);
    return true;
}

function entregarPedidoListo(pedidoId, waiterName) {
    const index = pedidos.findIndex(p => p.id === pedidoId && p.estado === "listo");
    if (index === -1) return false;
    if (pedidos[index].waiterName !== waiterName) return false;
    pedidos.splice(index, 1);
    guardarDatos();
    mostrarToast(`✅ Pedido #${pedidoId} entregado`, ["mesero"]);
    return true;
}

// ============================================================
// GESTIÓN MENÚ DEL DÍA
// ============================================================
function agregarItemMenuDia(nombre, precio) {
    const nuevo = { id: Date.now(), nombre: nombre.trim(), precio: parseFloat(precio) };
    menuDia.push(nuevo);
    guardarDatos();
    mostrarToast(`🍽️ "${nombre}" añadido al menú del día`, ["host"]);
}
function eliminarItemMenuDia(id) {
    menuDia = menuDia.filter(item => item.id !== id);
    guardarDatos();
    mostrarToast(`🗑️ Item eliminado del menú del día`, ["host"]);
}
function editarItemMenuDia(id, nuevoNombre, nuevoPrecio) {
    const item = menuDia.find(i => i.id === id);
    if (item) {
        item.nombre = nuevoNombre.trim();
        item.precio = parseFloat(nuevoPrecio);
        guardarDatos();
        mostrarToast(`✏️ Item actualizado`, ["host"]);
    }
}
function moverItemMenuDia(id, direccion) {
    const index = menuDia.findIndex(item => item.id === id);
    if (index === -1) return;
    const nuevoIndex = index + direccion;
    if (nuevoIndex < 0 || nuevoIndex >= menuDia.length) return;
    [menuDia[index], menuDia[nuevoIndex]] = [menuDia[nuevoIndex], menuDia[index]];
    guardarDatos();
    mostrarToast(`🔄 Item reordenado`, ["host"]);
}

// ============================================================
// RENDERIZADO DE VISTAS
// ============================================================
function actualizarVistaActual() {
    if (currentRole === "mesero") {
        const nombreInput = document.getElementById("meseroNombreInput");
        if (nombreInput) currentMeseroNombre = nombreInput.value.trim() || "Carlos";
    }
    if (currentRole === "host") renderHostView();
    else if (currentRole === "mesero") renderMeseroView();
    else if (currentRole === "cocina") renderCocinaView();
}

function renderHostView() {
    const container = document.getElementById("viewsContainer");
    if (!container) return;

    const mesasOrdenadas = [...mesas].sort((a, b) => a.numero - b.numero);

    let mesasHtml = '';
    mesasOrdenadas.forEach(mesa => {
        const estadoClass = `estado-${mesa.estado}`;
        mesasHtml += `
            <div class="table-item ${estadoClass}" data-id="${mesa.id}" title="Doble clic para editar sillas">
                <span class="table-number">${mesa.numero}</span>
                <span class="table-chairs">${mesa.capacidad} 🪑</span>
            </div>
        `;
    });

    container.innerHTML = `
        <div class="card-panel">
            <h2>🗺️ Plano del Restaurante</h2>
            <p>Haz clic para cambiar estado (Libre → Reservada → Ocupada → Libre). <strong>Doble clic para editar sillas.</strong></p>
            <div class="restaurant-map">
                <div class="tables-area">
                    ${mesasHtml}
                </div>
                <div class="legend">
                    <span class="legend-item"><span class="legend-color" style="background:#22c55e;"></span> Libre</span>
                    <span class="legend-item"><span class="legend-color" style="background:#facc15;"></span> Reservada</span>
                    <span class="legend-item"><span class="legend-color" style="background:#ef4444;"></span> Ocupada</span>
                </div>
            </div>
        </div>
        <div class="card-panel">
            <h2>📋 Menú del Día <span style="font-size:0.8rem;font-weight:400;color:var(--text-secondary);">(edición en tiempo real)</span></h2>
            <p>Los platos del día aparecerán en la vista del mesero. Usa las flechas ↑↓ para reordenar.</p>
            <div style="margin-bottom:1rem;">
                <div class="form-row">
                    <input type="text" id="nuevoItemNombre" placeholder="Nombre del plato" style="flex:2;">
                    <input type="number" id="nuevoItemPrecio" placeholder="Precio" step="0.01" style="flex:1;">
                    <button id="btnAgregarMenuDia" class="btn-principal" style="width:auto;padding:0.6rem 1.8rem;flex:0 0 auto;">➕ Añadir</button>
                </div>
            </div>
            <div id="listaMenuDiaHost"></div>
        </div>
        <div class="card-panel">
            <div class="aviso-ocupacion"><strong>📢 Últimas notificaciones</strong><br><span id="eventosHostList">${eventosOcupacion.map(e=>`🔹 ${e}`).join("<br>") || "Sin eventos"}</span></div>
        </div>
    `;

    // Evento click (cambiar estado)
    document.querySelectorAll('.table-item').forEach(el => {
        el.addEventListener('click', function(e) {
            // Evitar que se dispare el doble clic
            if (e.detail === 1) {
                const id = parseInt(this.dataset.id);
                cambiarEstadoMesa(id);
            }
        });
        // Evento doble clic (editar sillas)
        el.addEventListener('dblclick', function(e) {
            e.stopPropagation();
            const id = parseInt(this.dataset.id);
            editarCapacidadMesa(id);
        });
    });

    // Menú del día
    const lista = document.getElementById("listaMenuDiaHost");
    if (lista) {
        if (menuDia.length === 0) {
            lista.innerHTML = "<div class='empty-message'>No hay platos en el menú del día. ¡Añade algunos!</div>";
        } else {
            let html = "";
            menuDia.forEach((item, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === menuDia.length - 1;
                html += `
                    <div class="menu-item-card">
                        <div class="info">
                            <div class="nombre">${item.nombre}</div>
                            <div class="precio">$${item.precio.toFixed(2)}</div>
                        </div>
                        <div class="acciones">
                            <button class="btn-mover" data-id="${item.id}" data-dir="-1" ${isFirst ? 'disabled' : ''} title="Subir">↑</button>
                            <button class="btn-mover" data-id="${item.id}" data-dir="1" ${isLast ? 'disabled' : ''} title="Bajar">↓</button>
                            <button class="btn-secundario btn-editar-menu" data-id="${item.id}" style="padding:0.2rem 0.6rem;font-size:0.7rem;">✏️</button>
                            <button class="btn-peligro btn-eliminar-menu" data-id="${item.id}">🗑️</button>
                        </div>
                    </div>
                `;
            });
            lista.innerHTML = html;
            document.querySelectorAll(".btn-mover").forEach(btn => {
                btn.addEventListener("click", e => {
                    const id = parseInt(btn.dataset.id);
                    const dir = parseInt(btn.dataset.dir);
                    moverItemMenuDia(id, dir);
                });
            });
            document.querySelectorAll(".btn-editar-menu").forEach(btn => {
                btn.addEventListener("click", e => {
                    const id = parseInt(btn.dataset.id);
                    const item = menuDia.find(i => i.id === id);
                    if (!item) return;
                    const nuevoNombre = prompt("Nuevo nombre:", item.nombre);
                    if (nuevoNombre === null) return;
                    const nuevoPrecio = prompt("Nuevo precio:", item.precio);
                    if (nuevoPrecio === null) return;
                    const precioNum = parseFloat(nuevoPrecio);
                    if (isNaN(precioNum) || precioNum <= 0) { mostrarToast("Precio inválido", ["host"]); return; }
                    editarItemMenuDia(id, nuevoNombre, precioNum);
                });
            });
            document.querySelectorAll(".btn-eliminar-menu").forEach(btn => {
                btn.addEventListener("click", e => {
                    const id = parseInt(btn.dataset.id);
                    if (confirm("¿Eliminar este plato del menú del día?")) eliminarItemMenuDia(id);
                });
            });
        }
    }
    document.getElementById("btnAgregarMenuDia").addEventListener("click", () => {
        const nombre = document.getElementById("nuevoItemNombre").value.trim();
        const precio = parseFloat(document.getElementById("nuevoItemPrecio").value);
        if (!nombre) { mostrarToast("Ingresa un nombre", ["host"]); return; }
        if (isNaN(precio) || precio <= 0) { mostrarToast("Ingresa un precio válido", ["host"]); return; }
        agregarItemMenuDia(nombre, precio);
        document.getElementById("nuevoItemNombre").value = "";
        document.getElementById("nuevoItemPrecio").value = "";
    });
    document.getElementById("eventosHostList").innerHTML = eventosOcupacion.map(e=>`🔹 ${e}`).join("<br>") || "Sin eventos";
}

function renderMeseroView() {
    const container = document.getElementById("viewsContainer");
    if (!container) return;
    container.innerHTML = `
        <div class="card-panel">
            <h2>🧾 Tomar pedido</h2>
            <div class="flex-between">
                <label>👨‍🍳 Tu nombre</label>
                <input type="text" id="meseroNombreInput" value="${currentMeseroNombre}" style="flex:1; max-width:240px;">
            </div>
            <div style="margin-top:0.8rem;">
                <label>📌 Mesa ocupada</label>
                <select id="selectMesaPedido" style="width:100%;"></select>
            </div>
            <div style="margin-top:1.2rem;">
                <strong>🍕 Productos (Menú del Día)</strong>
                <div id="itemsDisponiblesMesero" class="items-list"></div>
                <div id="carritoPreviewMesero" class="carrito"></div>
                <button id="btnEnviarPedidoMesero" class="btn-principal">🚀 Enviar pedido a cocina</button>
            </div>
        </div>
        <div class="card-panel">
            <h3>✅ Mis pedidos listos</h3>
            <div id="pedidosListosMeseroPanel"></div>
            <div class="aviso-ocupacion" style="margin-top:0.8rem;">🔔 Recibirás notificaciones push cuando un pedido esté listo.</div>
        </div>
    `;
    const select = document.getElementById("selectMesaPedido");
    if (select) {
        const ocupadas = mesas.filter(m => m.estado === "ocupada");
        select.innerHTML = '<option value="">-- Mesa ocupada --</option>';
        ocupadas.forEach(m => select.innerHTML += `<option value="${m.id}">Mesa ${m.numero}</option>`);
        if (ocupadas.length === 0) select.innerHTML = '<option disabled>No hay mesas ocupadas</option>';
    }
    const itemsContainer = document.getElementById("itemsDisponiblesMesero");
    if (itemsContainer) {
        itemsContainer.innerHTML = "";
        if (menuDia.length === 0) {
            const msg = document.createElement("div");
            msg.className = "empty-message";
            msg.textContent = "📭 El menú del día está vacío. El Host debe añadir platos.";
            itemsContainer.appendChild(msg);
        } else {
            menuDia.forEach(item => {
                const span = document.createElement("span");
                span.className = "item-tag dia";
                span.textContent = `🔥 ${item.nombre} - $${item.precio.toFixed(2)}`;
                span.onclick = () => {
                    const exist = currentCarrito.find(i => i.nombre === item.nombre && i.id === item.id);
                    if (exist) exist.cantidad += 1;
                    else currentCarrito.push({ id: item.id, nombre: item.nombre, precio: item.precio, cantidad: 1, esDia: true });
                    renderCarrito();
                };
                itemsContainer.appendChild(span);
            });
        }
    }
    const renderCarrito = () => {
        const div = document.getElementById("carritoPreviewMesero");
        if (!div) return;
        if (currentCarrito.length === 0) { div.innerHTML = "🛒 Carrito vacío."; return; }
        let html = `<strong>🧾 Pedido actual</strong><br>`;
        let total = 0;
        currentCarrito.forEach(i => {
            html += `<div class="pedido-item">${i.nombre} x${i.cantidad} <span>$${(i.precio * i.cantidad).toFixed(2)}</span></div>`;
            total += i.precio * i.cantidad;
        });
        html += `<hr style="border-color:var(--border-color);margin:0.5rem 0;"><strong>Total: $${total.toFixed(2)}</strong> <button id="vaciarCarritoMesero" style="background:#ef4444;color:white;border:none;padding:0.2rem 1rem;border-radius:var(--radius-full);cursor:pointer;">Vaciar</button>`;
        div.innerHTML = html;
        document.getElementById("vaciarCarritoMesero")?.addEventListener("click", () => { currentCarrito = []; renderCarrito(); });
    };
    renderCarrito();
    document.getElementById("btnEnviarPedidoMesero").onclick = () => {
        const mesaId = parseInt(document.getElementById("selectMesaPedido").value);
        const waiter = document.getElementById("meseroNombreInput").value.trim();
        if (!mesaId) return mostrarToast("Selecciona mesa", ["mesero"]);
        if (!waiter) return mostrarToast("Nombre requerido", ["mesero"]);
        if (currentCarrito.length === 0) return mostrarToast("Agrega productos", ["mesero"]);
        const itemsPedido = currentCarrito.map(it => ({ nombre: it.nombre, cantidad: it.cantidad, precio: it.precio }));
        if (agregarPedido(mesaId, itemsPedido, waiter)) {
            currentCarrito = [];
            renderCarrito();
        }
    };
    const actualizarListos = () => {
        const nombre = document.getElementById("meseroNombreInput")?.value.trim() || currentMeseroNombre;
        const misListos = pedidos.filter(p => p.estado === "listo" && p.waiterName === nombre);
        const panel = document.getElementById("pedidosListosMeseroPanel");
        if (!panel) return;
        if (misListos.length === 0) { panel.innerHTML = "<div class='empty-message'>📭 No hay pedidos listos para ti.</div>"; return; }
        let html = "";
        misListos.forEach(ped => {
            const mesaNum = mesas.find(m => m.id === ped.mesaId)?.numero || "?";
            html += `
                <div style="background:var(--bg-primary);padding:1rem;border-radius:var(--radius-md);margin:0.8rem 0;border-left:4px solid #f59e0b;">
                    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.4rem;"><strong>🍽️ Mesa ${mesaNum} | Pedido #${ped.id}</strong><span class="badge-mesero">👨‍🍳 ${ped.waiterName}</span></div>
                    <div style="font-size:0.9rem;margin:0.4rem 0;">📦 ${ped.items.map(i=>`${i.nombre} x${i.cantidad}`).join(", ")}</div>
                    <button class="btn-entregar" data-id="${ped.id}">✅ Entregar a cliente</button>
                </div>
            `;
        });
        panel.innerHTML = html;
        document.querySelectorAll(".btn-entregar").forEach(btn => btn.addEventListener("click", e => {
            if (entregarPedidoListo(parseInt(btn.dataset.id), nombre)) actualizarListos();
        }));
    };
    actualizarListos();
    document.getElementById("meseroNombreInput")?.addEventListener("input", actualizarListos);
}

function renderCocinaView() {
    const container = document.getElementById("viewsContainer");
    if (!container) return;
    container.innerHTML = `
        <div class="card-panel">
            <h2>👩‍🍳 Pedidos pendientes en cocina</h2>
            <p>Prepara y libera pedidos. El mesero recibirá una notificación push automática.</p>
            <div id="cocinaPedidosList"></div>
        </div>
    `;
    const actualizar = () => {
        const cont = document.getElementById("cocinaPedidosList");
        if (!cont) return;
        const pendientes = pedidos.filter(p => p.estado === "pendiente");
        if (pendientes.length === 0) { cont.innerHTML = "<div class='empty-message'>✅ Cocina sin pedidos pendientes</div>"; return; }
        let html = "";
        pendientes.forEach(ped => {
            const mesaNum = mesas.find(m => m.id === ped.mesaId)?.numero || "?";
            html += `
                <div class="pedido-pendiente">
                    <div class="flex-between"><strong>📌 Pedido #${ped.id} | Mesa ${mesaNum}</strong><span class="badge-mesero">👨‍🍳 ${ped.waiterName}</span></div>
                    <div style="margin:0.5rem 0;">🍲 ${ped.items.map(i=>`${i.nombre} x${i.cantidad}`).join(", ")}</div>
                    <button class="btn-liberar-pedido" data-id="${ped.id}">🔥 Liberar (listo para servir)</button>
                </div>
            `;
        });
        cont.innerHTML = html;
        document.querySelectorAll(".btn-liberar-pedido").forEach(btn => btn.addEventListener("click", e => {
            liberarPedidoCocina(parseInt(btn.dataset.id));
            actualizar();
        }));
    };
    actualizar();
}

// ============================================================
// NAVEGACIÓN ENTRE ROLES (con View Transitions)
// ============================================================
function setRoleWithTransition(role) {
    if (role === currentRole) return;
    const oldRole = currentRole;
    const btnElements = document.querySelectorAll(".btn-role");
    const activeBtn = Array.from(btnElements).find(b => b.dataset.role === role);
    const oldActive = Array.from(btnElements).find(b => b.dataset.role === oldRole);
    if (!activeBtn) return;
    const newIndex = Array.from(btnElements).indexOf(activeBtn);
    const oldIndex = Array.from(btnElements).indexOf(oldActive);
    const direction = newIndex > oldIndex ? "slide-right" : "slide-left";
    const updateDOM = () => {
        btnElements.forEach(btn => btn.classList.remove("active"));
        activeBtn.classList.add("active");
        currentRole = role;
        localStorage.setItem("resto_currentRole", role);
        document.getElementById("currentRoleBadge").innerText = role === "host" ? "👑 Host" : (role === "mesero" ? "🧑‍🍳 Mesero" : "🍳 Cocina");
        if (role !== "mesero") currentCarrito = [];
        actualizarVistaActual();
        mostrarToast(`👋 Cambiaste a ${role === "host" ? "Host" : role === "mesero" ? "Mesero" : "Cocina"}`, [role]);
    };
    const scope = document.getElementById("navRoleScope");
    if (scope.startViewTransition) {
        scope.startViewTransition({ update: updateDOM, types: [direction] });
    } else if (document.startViewTransition) {
        document.startViewTransition({ update: updateDOM, types: [direction] });
    } else {
        updateDOM();
    }
}

function initRoleButtons() {
    const btns = document.querySelectorAll(".btn-role");
    btns.forEach(btn => {
        btn.addEventListener("click", () => setRoleWithTransition(btn.dataset.role));
    });
    const currentBtn = Array.from(btns).find(b => b.dataset.role === currentRole);
    if (currentBtn) currentBtn.classList.add("active");
}

// ============================================================
// TEMA OSCURO/CLARO MANUAL
// ============================================================
function initTheme() {
    const savedTheme = localStorage.getItem("resto_theme");
    const body = document.body;
    const btn = document.getElementById("themeToggleBtn");
    const svg = btn.querySelector("svg");

    function applyTheme(theme) {
        body.classList.remove("dark-mode", "light-mode");
        if (theme === "dark") {
            body.classList.add("dark-mode");
            svg.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />`;
        } else {
            body.classList.add("light-mode");
            svg.innerHTML = `<circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />`;
        }
        localStorage.setItem("resto_theme", theme);
    }

    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        applyTheme(prefersDark ? "dark" : "light");
    }

    btn.addEventListener("click", () => {
        const isDark = body.classList.contains("dark-mode");
        applyTheme(isDark ? "light" : "dark");
    });
}

// ============================================================
// INICIALIZACIÓN
// ============================================================
async function init() {
    escucharCambios();

    const savedRole = localStorage.getItem("resto_currentRole");
    if (savedRole && ["host","mesero","cocina"].includes(savedRole)) currentRole = savedRole;
    else currentRole = "host";
    document.getElementById("currentRoleBadge").innerText = currentRole === "host" ? "👑 Host" : (currentRole === "mesero" ? "🧑‍🍳 Mesero" : "🍳 Cocina");

    await registerInternalSW();
    await registerFCMSW();

    initRoleButtons();

    document.getElementById("requestPermisoBtn").addEventListener("click", async () => {
        await requestFCMToken();
    });

    initTheme();
}

init();
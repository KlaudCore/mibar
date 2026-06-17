// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

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

const messaging = firebase.messaging();

// Manejar notificaciones en segundo plano (cuando la app está cerrada)
messaging.onBackgroundMessage((payload) => {
  console.log('Mensaje en segundo plano:', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/mibar/icon-192.png',
    badge: '/mibar/icon-192.png',
    vibrate: [200, 100, 200],
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Manejar clic en la notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/mibar/')
  );
});
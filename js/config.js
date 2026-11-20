// mFinance — bulut senkronu ayarları
// Supabase panelinde: Project Settings → API (ya da "Connect") bölümündeki değerleri buraya yapıştır.
// Bu iki değer herkese açık olacak şekilde tasarlanmıştır (anon/publishable key). Verilerini korumak
// supabase/schema.sql içindeki satır düzeyi güvenlik (RLS) kurallarıdır: herkes yalnızca kendi verisini görür.
// Boş bırakılırsa uygulama senkronsuz, yalnızca bu cihazda çalışır.
window.MFINANCE_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Bildirimler için genel (public) VAPID anahtarı. Özel anahtar yalnızca Vercel ortam değişkenindedir.
  vapidPublicKey: '',
};

# mFinance kurulumu: iPhone + bilgisayar, senkronlu

Toplam süre yaklaşık 15 dakika. Hepsi ücretsiz.

## 1. Supabase (bulut veritabanı)

1. <https://supabase.com> → **Start your project** → GitHub ya da e-postayla hesap aç.
2. **New project**:
   - Name: `mfinance`
   - Database password: güçlü bir şifre üret ve bir yere kaydet (uygulamada kullanılmaz).
   - Region: **Central EU (Frankfurt)**, Türkiye'ye en yakın bölge.
3. Proje hazır olunca sol menüden **SQL Editor** → **New query** → [`supabase/schema.sql`](supabase/schema.sql) dosyasının tamamını yapıştır → **Run**. "Success" görmelisin.
4. **Project Settings → API** (ya da üstteki **Connect** düğmesi) bölümünden iki değeri kopyala:
   - **Project URL**: `https://xxxx.supabase.co`
   - **anon / publishable key**: `eyJ...` ya da `sb_publishable_...`

   **service_role / secret key'i ASLA kullanma.** O anahtar tüm güvenlik kurallarını atlar.
5. Bu iki değeri [`js/config.js`](js/config.js) içine yapıştır:

   ```js
   window.MFINANCE_CONFIG = {
     supabaseUrl: 'https://xxxx.supabase.co',
     supabaseAnonKey: 'eyJ...',
   };
   ```

   Bu anahtarın sitede görünmesi normaldir. Verilerini, SQL dosyasındaki kurallar korur: her hesap yalnızca kendi verisini görebilir.

6. **Authentication → Sign In / Providers → Email**:
   - Yalnızca kendin kullanacaksan **Confirm email** seçeneğini kapat; hesap oluşturunca direkt giriş yaparsın.
   - Açık bırakırsan hesap oluşturduktan sonra e-postandaki bağlantıya tıklaman gerekir.
7. *(Önerilir)* Hesabını oluşturduktan sonra **Authentication → Sign In / Providers** bölümünde **Allow new users to sign up** seçeneğini kapat. Böylece adresini bulan başka biri hesap açamaz.

## 2. İnternete yükleme (Vercel)

1. Bir kereliğine giriş yap. Proje klasöründe terminal aç ve şunu çalıştır:

   ```bash
   npx vercel login
   ```

   Çıkan bağlantıyı tarayıcıda açıp onayla.
2. Yayına al:

   ```bash
   npx vercel deploy --prod --yes
   ```

   Sonunda sana `https://mfinance-xxxx.vercel.app` gibi bir adres verir. Adresi Vercel panelinde **Settings → Domains** bölümünden değiştirebilirsin.
3. Supabase'e geri dön: **Authentication → URL Configuration → Site URL** alanına bu Vercel adresini yaz. Onay e-postaları buraya yönlenir.

Güncelleme yaptığında aynı `npx vercel deploy --prod --yes` komutunu tekrar çalıştırman yeterli. Telefondaki uygulama bir sonraki açılışta yeni sürümü alır.

`.claude`, `supabase` klasörleri ve bu rehber `.vercelignore` sayesinde internete yüklenmez.

## 3. iPhone'a kurma

1. **Safari**'de Vercel adresini aç. Chrome değil, mutlaka Safari olmalı; iOS ana ekrana eklemeyi Safari'den yapıyor.
2. Alttaki **Paylaş** düğmesi (yukarı oklu kare) → **Ana Ekrana Ekle** → **Ekle**.
3. Ana ekrandaki **mFinance** ikonundan aç.
4. **Ayarlar → Hesap ve senkron** → e-posta + şifre → **Hesap oluştur** (ilk seferde), sonra **Giriş yap**.
5. **Ayarlar → Uygulama kilidi → PIN belirle**. İstersen **Face ID ile aç** seçeneğini de aç.

## 4. Bilgisayara kurma

1. **Chrome** ya da **Edge**'de aynı adresi aç.
2. Adres çubuğunun sağındaki **Yükle** simgesine (ekranlı ok) ya da menü → **Uygulamayı yükle**'ye tıkla.
3. Uygulama ayrı bir pencerede açılır. **Aynı e-posta ve şifreyle** giriş yap; telefondaki verilerin birkaç saniye içinde gelir.
4. Bilgisayar için de ayrı bir PIN belirle (PIN her cihaza özeldir).

## Bilmen gerekenler

- **İnternetsiz de çalışır.** Kayıtların telefonda tutulur; internet gelince otomatik eşitlenir. İki cihazda aynı anda farklı kayıt eklesen de hiçbiri kaybolmaz.
- **PIN'i unutursan:** kilit ekranında "PIN'i unuttum" → hesaptan çıkış yapılır, cihazdaki kopya silinir → tekrar giriş yapınca veriler buluttan geri gelir.
- **Supabase ücretsiz planı**, bir hafta hiç kullanılmayan projeyi duraklatır. Uygulamayı düzenli açtığın sürece sorun olmaz. Duraklarsa Supabase panelinden tek tıkla yeniden başlatırsın; veriler silinmez.
- **Yedek** almaya devam et: Ayarlar → Yedek indir (.json). Ayda bir yeterli.

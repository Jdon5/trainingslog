# Trainingslog

Persönliche Trainings-App (PWA) für Kraft, Skill und Cardio. Die Daten werden zuerst auf dem Gerät gespeichert und mit Supabase synchronisiert.

- `index.html`, `app.js`, `app.css`: die App
- `sw.js`: Offline-Speicher
- `vendor/supabase.js`: Supabase-Client
- `fonts/`, `icons/`: Schriften und App-Icons

Der Schlüssel in `app.js` ist der öffentliche (publishable) Key. Geschützt sind die Daten durch Login und Row Level Security.

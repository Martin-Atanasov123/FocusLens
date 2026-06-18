# FocusLens — Competitor & Feature Analysis

*Дълбок анализ на най-близките по концепция приложения и кои функции си струва да добавиш.*
*Изготвен: юни 2026. Източниците са в края.*

---

## 0. Как е позициониран FocusLens (актуализирано 2026-Q2)

> **Бележка за пивота:** Анализът по-долу е написан когато FocusLens беше
> privacy-first local tracker. Android приложението оттогава е ребрандирано
> и пренасочено като **самостоятелен premium consumer screen-time blocker**
> ("Opal за Android"). Blocking е ВЕЧЕ ✅ в продукта. Позиционирането е
> "Blocks TikTok after 30 minutes. Automatically." — не "privacy-first".
> North Star: 500 платени потребители преди да оптимизираш каквото и да е.

---

FocusLens е **privacy-first, local-only, single-user** screen-time трекер (десктоп),
плюс **Android consumer blocker** с RevenueCat paywall. Обединява **три
източника в една локална база**: десктоп активен прозорец (Python агент),
браузър по домейн (Chrome extension) и телефон по приложение (Android UsageStats).

**Текущо изградено:**

- Десктоп: автоматичен tracking, категории + правила, лимити 50/80/100%, retention sweep.
- Android: FocusBlockerService (foreground service), daily limits (LimitStore), BlockActivity overlay, Focus Sessions, Onboarding (3 стъпки), RevenueCat paywall (react-native-purchases v10), Sentry crash reporting.
- Десктоп + мобилен дашборд + WebView; QR/token сдвояване; tunnel.

**Pending (от плана):** Streaks (Phase 3), Scheduled Blocks (Phase 5), Play Store (Phase 7).

**Moat на десктопа:** обединяването телефон+компютър+браузър в един локален изглед.
**Moat на мобилното:** premium блокер за Android с добре направен UX (Opal не е на Android).

---

## 1. Конкурентна карта (подредена по близост до твоята концепция)

| Tier | Приложение | Защо е релевантно | Модел |
|---|---|---|---|
| **1 — почти идентична концепция** | **ActivityWatch** | Free, open-source, local-only, cross-platform (Win/Mac/Linux/Android), модулни "watchers". Твоят най-близък идеологически двойник. | Open-source, local |
| **1** | **ManicTime** | Local-by-default, автоматичен tracking + idle, document/URL granularity, stopwatch. | Freemium (local; платен sync server) |
| **1** | **Tockler** | Open-source local десктоп трекер (по-семпъл от AW). | Open-source, local |
| **2 — същ домейн, cloud-first** | **RescueTime** | Productivity score, Focus Sessions с блокиране, goals, alerts, седмични имейли. | Cloud, freemium |
| **2** | **Rize.io** | AI категоризация, focus-time/context-switch метрики, break/overwork reminders. | Cloud, платен |
| **2** | **Timing (macOS)** | Автоматичен, document/URL granularity, AI summaries, **Screen Time import от iPhone**. | Cloud sync, платен |
| **2** | **Toggl Track / Clockify** | Manual + timeline; project/client/billable. По-скоро work-tracking. | Cloud, freemium |
| **3 — телефонна страна / focus** | **Digital Wellbeing (Android)** | App timers, Focus mode, Bedtime/grayscale, dashboard. Нативен бенчмарк за телефона. | Безплатно, нативно |
| **3** | **Opal** | Focus Sessions, Deep Focus (неотменим), Focus Score, streaks/rewards. iOS/macOS. | Платено |
| **3** | **one sec** | Friction/mindful пауза + дишане преди отваряне на разсейващо приложение. iOS/Android. | Freemium |
| **3** | **Jomo / Forest** | Шаблони, журнал, NFC tags; геймификация (дърво расте). | Freemium |

---

## 2. Дълбок разбор по приложение — какви услуги/функции предлагат

### ActivityWatch (твоят идеологически еталон)
- **Автоматичен tracking** на активен прозорец + window title; AFK (idle) изключване.
- **Категории** с regex правила за разбивка по области (точно като твоите rules).
- **Browser watchers** (Chrome/Firefox) за активен таб; **editor plugins** за coding time.
- **Модулна архитектура**: локален сървър + "watchers" — всеки може да напише свой watcher (IDE, музика, спорт). Това е тяхното разширяемо предимство.
- **Local-only**, без облак, без акаунти — данните остават на устройството.
- **Слабост:** cross-device синхронизацията е призната като слаба → **твоят шанс**.

### ManicTime
- **Local-by-default**, работи офлайн напълно.
- Записва приложения, сайтове (browser integration) и **документи + file paths**.
- **Idle detection с "what were you doing?" prompt** — при връщане те пита да отбележиш срещата/паузата.
- **Stopwatch** за ръчно проследяване (само в платената версия).
- Tagging и rich timeline.

### Tockler
- Open-source локален десктоп трекер: app + title timeline, дневен/седмичен изглед, прости тренд графики. По-лек от AW, без телефон.

### RescueTime
- **Productivity score** (всяка активност е "productive"/"distracting" по подразбиране, редактируемо).
- **Focus Sessions** — блокира разсейващи сайтове/приложения за зададен таймер; авто-блокира категории Personal/Distractions.
- **Goals** — дневни таргети с реалтайм прогрес.
- **Smart alerts** — известие/авто-стартиране на focus session/отваряне на URL при тригер.
- **Reports** — app/URL/window title/start-end; **CSV export + имейл отчети**.

### Rize.io
- **AI категоризация** на всяко app/site/document; учи кое към кой проект/клиент е → billable hours без ръчен вход.
- **Focus-time метрика** (продължителна работа без context-switching), честота на разсейване, deep-work сесии.
- **Break reminders** (AI, спрямо активността) + **overwork notifications** при надхвърляне на дневен лимит.
- **Distraction blocker** (поп-ъп или леко известие) + библиотека focus музика.
- Дневни/седмични отчети с препоръки.

### Timing (macOS)
- Автоматичен, **document/URL/email-subject granularity**.
- **AI summaries** на деня.
- **Screen Time import от iPhone/iPad** — обединява телефон в десктоп изгледа (точно твоята идея, но Apple-only).
- "Privacy-first, local by default", но синхронизира през техния облак (компромис, който ти нямаш).

### Toggl Track / Clockify
- Предимно **ръчни таймери** + timeline, който драфтва записи за потвърждение.
- Project/client/tag/billable, екипни отчети. По-скоро бизнес/freelance, не личен wellbeing.

### Digital Wellbeing (Android) — нативен бенчмарк за телефона
- **Dashboard**: pie chart дневно време, unlocks, нотификации, per-app drill-down.
- **App timers**: дневен лимит → приложението се "паузира" за деня.
- **Focus mode**: пауза на избрани разсейващи приложения, по график.
- **Bedtime mode**: grayscale + DND + заглушаване нощем.
- Family Link родителски контрол.

### Opal / one sec / Jomo / Forest (focus & mindfulness)
- **Opal**: Focus Sessions, **Deep Focus** (не може да се прескочи), **Focus Score**, recurring sessions, rewards/streaks.
- **one sec**: **когнитивна пауза + дишане** преди отваряне на приложение — прекъсва навика без твърда забрана. (Изследователски най-ефективният лек подход.)
- **Jomo**: шаблони, журнал/интроспекция, NFC tags.
- **Forest**: геймификация — дърво расте докато не пипаш телефона.

---

## 3. Feature матрица — кой какво има vs FocusLens

| Функция | FocusLens днес | AW | ManicTime | RescueTime | Rize | Digital Wellbeing | Opal/one sec |
|---|---|---|---|---|---|---|---|
| Автоматичен app tracking | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Browser per-domain | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Телефон usage в общ изглед | ✅ **(moat)** | частично | — | ✅ (mobile app отделно) | — | ✅ (само телефон) | — |
| Idle detection | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| "Какво правеше?" idle prompt | ❌ | ❌ | ✅ | — | — | — | — |
| Категории/правила | ✅ | ✅ | ✅ | ✅ | ✅ (AI) | — | — |
| Productivity score | ❌ | частично | ❌ | ✅ | ✅ | — | ✅ (Focus Score) |
| Focus-time / context-switch метрика | ❌ | ❌ | ❌ | частично | ✅ | — | — |
| Goals / дневни таргети | ❌ | ❌ | ❌ | ✅ | ✅ | App timers | ✅ |
| Лимити + прагови известия | ✅ (50/80/100%) | ❌ | частично | ✅ | ✅ | ✅ | ✅ |
| Focus session / блокиране | ✅ **(Android)** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Mindful friction (пауза преди app) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (one sec) |
| Break / overwork reminders | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | — |
| Stopwatch / ръчно time entry | ❌ | ❌ | ✅ | ❌ | ❌ | — | — |
| Document/URL granularity | ❌ (само app/domain) | title | ✅ | ✅ | ✅ | — | — |
| Седмичен имейл отчет | ❌ | ❌ | ❌ | ✅ | ✅ | — | — |
| CSV / data export + API | ❌ | ✅ | ✅ | ✅ | частично | — | — |
| Streaks / геймификация | ❌ | ❌ | ❌ | ❌ | ❌ | — | ✅ |
| Bedtime / grayscale wind-down | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| Cross-device sync (добре направен) | ✅ (твоят фокус) | ⚠️ слаб | платен server | ✅ cloud | — | — | — |

---

## 4. Препоръки за FocusLens — приоритизирани, класифицирани по съответствие с local-only етоса

Класификация: **🟢 Перфектно пасва** (local, privacy, усилва moat-а) · **🟡 Пасва с уговорки** ·
**🔴 Конфликт с етоса / друг продукт** (помисли дваж).

### 🟢 Tier 1 — висока стойност, нисък риск, локално (направи първо)

1. **Productivity / Focus score.** Прости правила вече имаш (категории). Добави "productive vs distracting vs neutral" флаг на категория и изчисли дневен скор. Това е метриката, която прави RescueTime/Rize "лепкави" — а при теб е чисто локална математика върху съществуващата `usage_minutes`. *Усилва retention.*

2. **Goals / дневни таргети.** "Под 2ч соц. мрежи", "над 4ч deep work". Преизползваш `limits` инфраструктурата (вече имаш прагове и нотификации) — добавяш и таргети-за-минимум, не само лимити. *Нисък ефорт, висок ефект.*

3. **CSV / JSON export + локален read API.** Ти вече имаш Flask с `/api/summary`, `/api/trends`. Добави `/api/export?from=&to=` → CSV. Privacy-обещанието "данните са твои" става осезаемо — потребителят може да ги вземе. AW/ManicTime/RescueTime всички го имат; ти нямаш. *Trust move.*

4. **Седмично резюме — локално, не имейл.** "Изминалата седмица: −12% екранно време, топ движещо се приложение: X." Имаш `daily_totals` + `app_week_movers` вече — липсва само presentational седмичен изглед/нотификация. *Reuse of existing data.*

5. **Document/URL granularity (десктоп).** `probe.py` вече чете window title. Съхранявай го (опционално, зад toggle) за по-богат timeline като ManicTime/Timing. *Внимание: privacy — дръж го изключено по подразбиране и изключвай за определени приложения (банки, пароли).*

### 🟡 Tier 2 — стойностно, но изисква дизайн/съгласуване с етоса

6. **Idle "какво правеше?" prompt (ManicTime модел).** При връщане от idle → попитай: среща / пауза / друго. Превръща мъртвото време в данни. *Леко триене; направи го dismissible.*

7. **Break / overwork reminders (Rize модел).** "Работиш 90 мин без пауза." Локална логика върху минутните бъкети. *Пасва на wellbeing мисията; пази се от досада — праг + дедупликация, каквато вече имаш в `limits.py`.*

8. **Focus-time / context-switch метрика.** Брой превключвания между приложения/ден; най-дълга непрекъсната сесия. Чисто локална агрегация, силна "aha" метрика. *Diff срещу простите трекери.*

9. **Mindful friction на телефона (one sec модел).** Преди отваряне на избрано приложение → кратка пауза/намерение. Това е най-ефективният *лек* лост и е под-използван на Android. *Изисква Android accessibility/overlay — нетривиално, но идеологически чисто (без блокиране, само осъзнатост).*

10. **Streaks / леки постижения.** "5 дни под целта." Без точки-магазин. Геймификацията на Opal/Forest работи. *Дръж го честно и ненатрапчиво — иначе влиза в конфликт с премиум етоса.*

### 🔴 Tier 3 — внимавай: конфликт с концепцията или отделен продукт

11. **Твърдо блокиране на сайтове/приложения** — ~~Tier 3 препоръка (2026-Q1).~~
    **Вече ✅ в продукта.** Android пивотът направи блокирането ядро на приложението.
    `FocusBlockerService` + `BlockActivity` + `LimitStore` го имплементират.
    Препоръката по-долу е за десктопа — там blocking все още не е в плана.

12. **AI категоризация (Rize/Timing).** Изкушаващо, но: (а) местен LLM е тежък, облачен LLM **чупи local-only обещанието**, (б) твоите regex правила вече покриват 90%. *По-скоро подобри UX на правилата (авто-предложения от честите неназначени apps) отколкото истински AI.*

13. **Project/client/billable tracking (Toggl/Rize).** Това е freelance work-tracking аудитория, не лична wellbeing. *Scope creep — пропусни, освен ако умишлено не сменяш пазара.*

14. **Cloud sync между устройства (отвъд tunnel).** Твоето предимство е, че **нямаш** облак. Не строй sync server à la ManicTime/RescueTime. Подобри вместо това локалния pairing (cleartext fix + auto-firewall), за да работи безотказно. *Защити moat-а, не го търгувай.*

15. **Bedtime/grayscale (Digital Wellbeing).** Нативният Android вече го прави добре. *Не дублирай OS-а; интегрирай се с него, ако трябва.*

---

## 5. Извод в едно изречение

Не гони блокиране и AI — те или ти чупят local-only етоса, или вече ги има нативно.
**Удвой залога на това, което никой не прави добре: едно безшевно, локално, cross-device
огледало.** Слой отгоре с productivity score, goals, export и седмично резюме (всичко
локална математика върху данните, които вече събираш) — това е най-високата стойност при
най-нисък риск и най-малко предадена концепция.

---

## Sources

- [ActivityWatch — official site](https://activitywatch.net/) · [vs RescueTime](https://activitywatch.net/blog/activitywatch-vs-rescuetime/) · [GitHub](https://github.com/ActivityWatch/activitywatch)
- [ManicTime — automatic time tracking](https://www.manictime.com/features/automatic-time-tracking) · [why/automatic-tracking](https://www.manictime.com/why/automatic-tracking)
- [RescueTime — Focus Sessions](https://www.rescuetime.com/features/focus/solo) · [Managing Alerts](https://help.rescuetime.com/article/79-managing-alerts) · [Focus Settings](https://help.rescuetime.com/article/377-focus-settings)
- [Rize — Productivity](https://rize.io/features/productivity) · [AI time tracker](https://rize.io/l/ai-time-tracker)
- [Timing — Toggl alternatives / features](https://timingapp.com/blog/toggl-alternatives/) · [Mac time tracking apps](https://timingapp.com/blog/mac-time-tracking-apps/)
- [Android Digital Wellbeing — official](https://www.android.com/digital-wellbeing/) · [Google support](https://support.google.com/android/answer/9346420)
- [Opal — screen time](https://opalapp.com/screentime) · [Opal review 2026](https://mindsightnow.com/blogs/mindful-matters/opal-app-review)
- [Best screen time apps 2026 (Opal/one sec/Jomo)](https://habi.app/insights/best-screen-time-apps/)

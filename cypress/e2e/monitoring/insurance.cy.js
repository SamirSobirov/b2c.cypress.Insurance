// ResizeObserver loop — известный шум браузера на Nuxt-страницах: он приходит
// при открытии календаря и выпадающих списков. К доступности сайта отношения
// не имеет, тест из-за него ронять нельзя.
Cypress.on('uncaught:exception', (err) => {
  if (err.message.includes('ResizeObserver')) return false;
});

describe('Insurance Search Flow', () => {

  const EMAIL = Cypress.env('LOGIN_EMAIL');
  const PASSWORD = Cypress.env('LOGIN_PASSWORD');

  // Параметры поиска — менять здесь.
  // CODE — то, что сайт кладёт в query-параметр to на странице результатов.
  const COUNTRY = { NAME: 'Турция', CODE: 'TR' };
  const AGE = '21';

  // Даты считаем от дня прогона, а не фиксируем: захардкоженная дата рано или
  // поздно уедет в прошлое, и календарь отдаст её задизейбленной.
  const TRIP = { START_IN: 10, DURATION: 5 };  // старт = сегодня + 10, возврат = старт + 5

  // Карточка оффера на странице результатов. Семантический тег без своего
  // класса: Tailwind-классы у карточки меняются при любой правке вёрстки, а
  // data-v-* — это хеш scoped-стилей Vue, он новый после каждой сборки.
  // Проверено на выдаче: article'ы есть только у карточек, фильтры слева —
  // это div'ы внутри aside.
  const OFFER_CARD = 'main article';

  const T = {
    PAGE: 120000,
    UI: 30000,
    API: 45000,
    LOGOUT: 30000,
    SEARCH: 60000,   // POST /search/insurance: метапоиск опрашивает страховщиков
    RESULTS: 30000,  // бюджет на наполнение выдачи, после которого она считается пустой
  };

  const PAUSE = {
    MODAL: 1000,
    FIELD: 500,
    SUBMIT: 800,
    TAB: 1000,
    OVERLAY: 800,   // анимация открытия/закрытия оверлеев PrimeVue
    SETTLE: 2000,   // окно, за которое проверяем, что выдача перестала пополняться
  };

  // Форма поиска обёрнута в data-reveal — анимацию появления сайт запускает,
  // когда обёртка входит во вьюпорт. Клики по выпадающим спискам прокручивают
  // страницу, после выбора страны она сама прыгает в начало, и обёртка
  // остаётся в исходном состоянии анимации: opacity: 0 и сдвиг на 24px вниз.
  // Поля при этом на месте и кликабельны, но Cypress считает их невидимыми и
  // висит на should('be.visible') до таймаута.
  //
  // Одного cy.scrollTo('top') не хватает: если страница уже наверху, скролла
  // не происходит и анимации нечем сработать (проверено — обёртка остаётся в
  // opacity: 0 и через 4.5 секунды). Уводим форму за пределы вьюпорта и
  // возвращаем обратно — на входе анимация проигрывается заново.
  //
  // Вызывать только когда все оверлеи закрыты: PrimeVue привязывает их к
  // координатам поля и на скролле закрывает.
  const backToForm = () => {
    cy.scrollTo(0, 900);   // 900 > высоты вьюпорта: форма гарантированно ушла
    cy.wait(PAUSE.OVERLAY);
    cy.scrollTo('top');
    cy.wait(PAUSE.OVERLAY);
    cy.get('.insurance-search', { timeout: T.UI }).should('be.visible');
  };

  const pad = (n) => String(n).padStart(2, '0');
  const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  };
  // 11.08.2026 — формат поля "Выберите даты путешествия"
  const ru = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  // 2026-08-11 — формат query-параметров на странице результатов
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  before(() => {
    expect(EMAIL, 'секрет CYPRESS_LOGIN_EMAIL не задан').to.be.a('string').and.not.be.empty;
    expect(PASSWORD, 'секрет CYPRESS_LOGIN_PASSWORD не задан').to.be.a('string').and.not.be.empty;
  });

  beforeEach(() => {
    // Значения по умолчанию: если прогон упадёт раньше, в отчёте останется
    // явный UNKNOWN / N/A, а не результат предыдущего запуска.
    cy.writeFile('auth_api_status.txt', 'UNKNOWN');
    cy.writeFile('api_status.txt', 'UNKNOWN');
    cy.writeFile('offers_count.txt', 'N/A');
  });

  // Авторизация и поиск — один тест, а не два: между тестами Cypress чистит
  // куки и localStorage (test isolation), и вторая часть осталась бы без сессии.
  it('Авторизация и поиск страховки', () => {
    cy.viewport(1280, 800);

    const today = new Date();
    const startDate = addDays(today, TRIP.START_IN);
    const endDate = addDays(startDate, TRIP.DURATION);

    // 1. ПЕРЕХВАТ API
    cy.intercept({ method: 'POST', url: '**/login**' }).as('apiAuth');
    cy.intercept({ method: 'POST', url: '**/api/v1/search/insurance**' }).as('apiSearch');

    // 2. ПЕРЕХОД НА ГЛАВНУЮ
    cy.visit('https://metatrip.asia/ru/', { timeout: T.PAGE });

    // 3. ОТКРЫТИЕ МОДАЛКИ "ВХОД В ПРОФИЛЬ"
    // Клик с повтором: страница на Nuxt приходит с сервера уже отрисованной,
    // и до окончания гидратации кнопка кликается вхолостую — модалка не встаёт.
    // На раннере GitHub Actions это ловилось стабильно, локально почти никогда.
    cy.clickUntilVisible('nav button', '.p-dialog', {
      text: 'Войти',
      timeout: T.UI,
      pause: PAUSE.MODAL,
    });

    cy.get('.p-dialog', { timeout: T.UI }).should('be.visible').within(() => {
      cy.contains('Вход в профиль', { timeout: T.UI }).should('be.visible');

      // 4. ВВОД ПОЧТЫ
      cy.fillInput('input[name="email"]', EMAIL, { timeout: T.UI });
      cy.wait(PAUSE.FIELD);

      // 5. ВВОД ПАРОЛЯ
      cy.fillInput('input[name="password"]', PASSWORD, { timeout: T.UI });
      cy.wait(PAUSE.SUBMIT);

      // 6. КЛИК "ВОЙТИ"
      cy.get('button[aria-label="Войти"]', { timeout: T.UI })
        .should('be.visible')
        .and('have.attr', 'data-p-disabled', 'false')
        .click({ timeout: T.UI });
    });

    // 7. УМНАЯ ПРОВЕРКА ОТВЕТА СЕРВЕРА
    cy.wait('@apiAuth', { timeout: T.API }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;
      cy.writeFile('auth_api_status.txt', statusCode.toString());

      if (statusCode >= 400) {
        throw new Error(`🆘 Ошибка сервера при авторизации: HTTP ${statusCode}`);
      }
    });

    // 8. ПРОВЕРКА УСПЕШНОГО ВХОДА (UI)
    cy.get('.p-dialog', { timeout: T.LOGOUT }).should('not.exist');
    cy.get('body', { timeout: T.UI })
      .should('not.contain', 'Неверный логин')
      .and('not.contain', 'Ошибка');

    cy.log('✅ Авторизация прошла успешно');

    // 9. ВКЛАДКА "СТРАХОВАНИЕ" НА ГЛАВНОЙ
    // Клик с повтором: форма поиска монтируется только после гидратации вкладок.
    cy.clickUntilVisible('button[role="tab"]', '.insurance-search', {
      text: 'Страхование',
      timeout: T.UI,
      pause: PAUSE.TAB,
    });

    cy.get('.insurance-search', { timeout: T.UI }).should('be.visible');

    // 10. "КУДА": открываем мультиселект стран
    cy.clickUntilVisible('.insurance-search .p-multiselect', '.p-multiselect-overlay', {
      timeout: T.UI,
      pause: PAUSE.OVERLAY,
    });

    // 11. ФИЛЬТР ПО НАЗВАНИЮ СТРАНЫ
    // В списке ~250 стран, и нужная лежит далеко за пределами видимой части
    // оверлея — поиск по названию это штатный способ до неё добраться.
    cy.fillInput('input.p-multiselect-filter', COUNTRY.NAME, { timeout: T.UI });

    // 12. ВЫБОР СТРАНЫ ИЗ СПИСКА
    // Точное совпадение по aria-label, а не по тексту: в li лежит ещё и чекбокс,
    // а под фильтр "Турция" попадает в том числе группа-заголовок списка.
    cy.get(`li.p-multiselect-option[aria-label="${COUNTRY.NAME}"]`, { timeout: T.UI })
      .should('be.visible')
      .click({ timeout: T.UI });

    cy.get('.insurance-search .p-multiselect-label', { timeout: T.UI })
      .should('contain.text', COUNTRY.NAME);

    // Мультиселект после выбора остаётся открытым (это множественный выбор) —
    // закрываем сами, иначе оверлей перехватит следующий клик по форме.
    cy.get('body').then(($body) => {
      if ($body.find('.p-multiselect-overlay').length === 0) return;
      cy.get('.insurance-search .p-multiselect').click({ timeout: T.UI });
    });
    cy.get('.p-multiselect-overlay', { timeout: T.UI }).should('not.exist');
    backToForm();

    // 13. ДАТЫ ПУТЕШЕСТВИЯ
    cy.clickUntilVisible('.insurance-search input.p-datepicker-input', '.p-datepicker-panel', {
      timeout: T.UI,
      pause: PAUSE.OVERLAY,
    });
    cy.get('.p-datepicker-panel', { timeout: T.UI }).should('be.visible');

    // Календарь открывается на текущем месяце и показывает два месяца рядом.
    // Обе даты отстоят от сегодня не больше чем на 15 дней, а в месяце минимум
    // 28 — значит, они всегда попадают в текущий или следующий месяц, и листать
    // месяцы не нужно: достаточно взять нужный из двух календарей.
    const monthOffset = (date) =>
      (date.getFullYear() - today.getFullYear()) * 12 + (date.getMonth() - today.getMonth());

    // Дни соседних месяцев календарь рисует тоже (в августе видны 27–31 июля и
    // 1–6 сентября), и по aria-label они не отличаются от своих — иначе клик по
    // "1" в августе мог бы попасть в 1 сентября.
    const pickDay = (date) => {
      cy.get('.p-datepicker-panel .p-datepicker-calendar', { timeout: T.UI })
        .eq(monthOffset(date))
        .find(`td[aria-label="${date.getDate()}"]:not(.p-datepicker-other-month) span.p-datepicker-day`)
        .not('.p-disabled')
        .click({ timeout: T.UI });
      cy.wait(PAUSE.FIELD);
    };

    pickDay(startDate);
    pickDay(endDate);

    // Диапазон реально встал в поле — ловим промах по календарю сразу здесь,
    // а не через пустую выдачу десятью шагами ниже.
    cy.get('.insurance-search input.p-datepicker-input', { timeout: T.UI })
      .should('have.value', `${ru(startDate)} - ${ru(endDate)}`);

    // Выбранный диапазон закрывает календарь сам — оверлеев нет, можно скроллить
    backToForm();

    // 14. ВОЗРАСТ КЛИЕНТА
    // Видимое поле "Возраст клиента" — readonly-триггер: по клику открывается
    // попап, куда и вписываем возраст. Клик с повтором ещё и потому, что первым
    // кликом может закрыться календарь.
    cy.clickUntilVisible('.insurance-search .ages-trigger__input', '.ages-popover', {
      timeout: T.UI,
      pause: PAUSE.OVERLAY,
    });

    // Кнопку "+ Добавить" не трогаем: она добавляет ещё одного застрахованного,
    // а нам нужен один. Значение подхватывается из поля само.
    cy.fillInput('.ages-popover__input', AGE, { timeout: T.UI });

    // Попап закрываем сами, Escape'ом. Перед вводом Cypress подкручивает поле к
    // верху экрана (scrollBehavior: 'top'), и форма уезжает вверх за пределы
    // вьюпорта: следующий шаг ("Цель поездки") падал на проверке видимости.
    // Вернуть форму скроллом, пока попап открыт, нельзя — PrimeVue закрывает
    // оверлеи на скролле, и возраст остался бы невведённым.
    cy.get('.ages-popover__input', { timeout: T.UI }).type('{esc}');
    cy.get('.ages-popover', { timeout: T.UI }).should('not.exist');

    // Возраст встал в поле — проверяем до поиска, иначе он уйдёт без
    // застрахованного (в поле-триггере значение появляется только после
    // закрытия попапа).
    cy.get('.insurance-search .ages-trigger__input', { timeout: T.UI })
      .should('have.value', AGE);

    backToForm();

    // 15. ЦЕЛЬ ПОЕЗДКИ — первый пункт списка
    cy.clickUntilVisible('.insurance-search .p-select', '.p-select-overlay', {
      timeout: T.UI,
      pause: PAUSE.OVERLAY,
    });

    cy.get('.p-select-overlay li.p-select-option', { timeout: T.UI })
      .should('have.length.greaterThan', 0)
      .first()
      .should('be.visible')
      .click({ timeout: T.UI });

    cy.get('.p-select-overlay', { timeout: T.UI }).should('not.exist');

    backToForm();

    // 16. ПОИСК
    cy.get('.insurance-search__submit', { timeout: T.UI })
      .should('be.visible')
      .and('not.be.disabled')
      .click({ timeout: T.UI });

    // 17. ПОИСК ДЕЙСТВИТЕЛЬНО УШЁЛ С НУЖНЫМИ ПАРАМЕТРАМИ
    // Проверка обязательна: при незаполненном поле кнопка молча ничего не
    // делает, клик проходит без ошибки и тест выглядит зелёным. Все параметры
    // формы видны в query-строке страницы результатов.
    cy.url({ timeout: T.PAGE })
      .should('include', '/insurance')
      .and('include', `to=${COUNTRY.CODE}`)
      .and('include', `startDate=${iso(startDate)}`)
      .and('include', `endDate=${iso(endDate)}`)
      .and('include', `passengerAges=${AGE}`);

    // 18. СТАТУС ПОИСКОВОГО API
    cy.wait('@apiSearch', { timeout: T.SEARCH }).then((interception) => {
      const statusCode = interception.response?.statusCode || 500;
      cy.writeFile('api_status.txt', statusCode.toString());

      if (statusCode >= 400) {
        throw new Error(`🆘 Ошибка сервера при поиске страховки: HTTP ${statusCode}`);
      }
    });

    cy.log('✅ Поиск запущен');

    // 19. ПОДСЧЁТ ОФФЕРОВ
    // Берём не первое значение, а стабилизировавшееся: карточки дорисовываются
    // после гидратации, иначе в отчёт попадёт случайное число.
    // Число пишем в файл до проверки: при пустой выдаче отчёт должен показать
    // "⚪ No Offers" с нулём, а не "🔴 Unknown Test Failure" без числа.
    cy.countWhenStable(OFFER_CARD, { timeout: T.RESULTS, settle: PAUSE.SETTLE }).then((count) => {
      cy.writeFile('offers_count.txt', count.toString());
      cy.log(`✅ Найдено предложений по страховке (${COUNTRY.NAME}): ${count}`);

      expect(count, 'офферов в выдаче').to.be.greaterThan(0);
    });

    cy.screenshot('after-search', { capture: 'viewport' });
  });
});

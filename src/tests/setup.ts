// Muss vor allen anderen Modulen geladen werden: Testumgebung statt .env
process.env.DB_PATH = ':memory:';
process.env.PUBLIC_URL = 'http://localhost:3000';
process.env.ADMIN_STEAM_IDS = '76561198000000001';
process.env.SCHEDULER = 'aus';
process.env.HTTP_MIN_GAP_MS = '0';
process.env.LEGION_CHECK = 'an';
process.env.DEV_LOGIN = 'aus';
process.env.AION_LEGION = 'Altersheim';
process.env.RESET_TIMEZONE = 'UTC';
process.env.RESET_TIME = '07:00';
process.env.RESET_WEEKDAY = '3';

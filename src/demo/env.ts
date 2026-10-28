// Umgebung für den Demo-Modus – muss vor allen anderen Modulen geladen werden.
process.env.DEMO = 'an';
process.env.DEV_LOGIN = 'an';
process.env.SCHEDULER = 'aus';
process.env.LEGION_CHECK = 'an';
process.env.HTTP_MIN_GAP_MS = '0';
process.env.PORT = process.env.PORT || '3000';
process.env.PUBLIC_URL = `http://localhost:${process.env.PORT}`;
process.env.DB_PATH = ':memory:';
process.env.ADMIN_STEAM_IDS = '76561190000000001';
process.env.AION_LEGION = process.env.AION_LEGION || 'Altersheim';

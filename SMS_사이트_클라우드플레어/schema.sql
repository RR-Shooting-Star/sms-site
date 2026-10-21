-- 신락전야 괴담 피드 D1 테이블 (처음 한 번만 실행)
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  who TEXT
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post INTEGER NOT NULL,
  body TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  who TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post);
CREATE TABLE IF NOT EXISTS votes (
  post INTEGER NOT NULL,
  who TEXT NOT NULL,
  v INTEGER NOT NULL,
  PRIMARY KEY (post, who)
);
CREATE TABLE IF NOT EXISTS rate (
  who TEXT PRIMARY KEY,
  last INTEGER NOT NULL
);

-- 처음 깔아 두는 세계관 글
INSERT INTO posts (body, name, created, who) VALUES
('남문시장 정류장에 비 오는 날마다 노란 우비 입은 애 있잖아. 우산 좀 씌워 달래서 같이 썼는데 집 앞까지 진짜 비 한 방울도 안 맞음.
근데 지금 생각해 보니까 우비 소매 끝에 손이 없었던 것 같기도 하고…', '', CAST(strftime('%s','now') AS INTEGER) * 1000 - 259200000, 'seed'),
('어제 모동 또 정전됨. 골목에 종이 등롱 머리 달린 애들이 줄줄이 서서 길 비춰 주더라. 불 들어오니까 싹 흩어짐.
이제 무섭지도 않음 고마울 지경', '모동주민', CAST(strftime('%s','now') AS INTEGER) * 1000 - 172800000, 'seed'),
('자정에 대문로 한가운데 건너지 마세요. 흰 그림자들이 꽃상여 메고 지나가는데 길 비켜 주면 아무 일 없대요.
막아서면 행렬에 섞인대요.', '', CAST(strftime('%s','now') AS INTEGER) * 1000 - 72000000, 'seed'),
('하얀아, 이거 보면 연락한번만 해줄래?', '윤나래', CAST(strftime('%s','now') AS INTEGER) * 1000 - 21600000, 'seed');

UPDATE posts SET images = '["images/rumor/narae.webp"]' WHERE who = 'seed' AND name = '윤나래';

# LRU Caching Server

A lightweight Node.js server using Express, Sequelize (MariaDB), and an in-memory LRU cache to speed up data retrieval.

---

## Features

- **LRU Cache** with configurable size and TTL
- **MariaDB** persistence via Sequelize ORM
- **Cache→DB** fallback: reads hit cache first, then DB, and auto-populate cache
- **Create & Cache**: POST endpoint inserts into DB and cache
- **Error Handling** with clear HTTP status codes and messages
- **Desktop Integration**: simple to hook into any desktop app (Electron, .NET, etc.)
- **SQLite Fallback**: automatic in-memory DB when MariaDB is unavailable

---

## Getting Started

1. Copy `.env.example` to `.env` and fill in your credentials and cache settings.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
**Note:** If MariaDB is not configured or reachable, the server will automatically fallback to an in-memory SQLite DB (no extra setup required).
4. The API listens on `http://localhost:3000` by default.

### Environment Variables

```dotenv
DB_HOST=localhost       # MariaDB host
DB_PORT=3306            # MariaDB port
DB_USER=root            # DB username
DB_PASS=password        # DB password
DB_NAME=mydb            # Database name
CACHE_MAX=100           # Max number of items in cache
CACHE_TTL=300000        # Cache TTL in ms (default 5m)
PORT=3000               # HTTP port
```

---

## Docker & Local Development

```bash
docker-compose up -d
```

_Or_ build and run directly:
```bash
docker build -t lru-caching . \
  && docker run --env-file .env -p 3000:3000 lru-caching
```

Follow logs:
```bash
docker-compose logs -f
```

The `docker-compose.yml` maps port `3306` for MariaDB and `3000` for the API.

---

## API Docs

Browse the interactive Swagger UI at [http://localhost:3000/docs](http://localhost:3000/docs).

---

## API Endpoints

### GET /items/:id

- **200 OK** `{ source: 'cache'|'db', item }`
- **404 Not Found** `{ error: 'Not found' }`
- **500 Internal** `{ error: 'Internal Server Error' }`

#### Example
```bash
curl http://localhost:3000/items/1
```

### POST /items

- **400 Bad Request** on missing `name`
- **201 Created** returns new item and caches it
- **500 Internal** on DB errors

#### Body
```json
{ "name": "foo", "value": "bar" }
```

#### Example
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"name":"foo","value":"bar"}' \
  http://localhost:3000/items
```

---

## Error Handling & Logging

- Input validation: missing or invalid fields ⇒ **400**
- Not found ⇒ **404**
- Unexpected failures ⇒ **500**, with console error logs
- You can plug in a logger (winston/pino) in `src/index.js`

---

## Advanced Cache Policies

Configuration via env (`CACHE_MAX`, `CACHE_TTL`). You can also:

```js
// custom per-item TTL
cache.set(key, value, { ttl: 1000 * 60 * 10 });  // 10m for this entry

// allow stale reads while repopulating
const cache = new LRU({ max: 100, ttl: 300000, allowStale: true });

// listen for evictions
cache.on('evict', ({ key, value }) => {
  console.log(`Evicted ${key}`);
});
```

---

## Desktop Integration

You can consume these endpoints from any desktop environment. Examples:

### Electron / JavaScript

```js
import axios from 'axios';
const API = 'http://localhost:3000';

async function fetchItem(id) {
  try {
    const { data } = await axios.get(`${API}/items/${id}`);
    console.log(data);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}
```

### .NET / C#

```csharp
using System.Net.Http;
using System.Text.Json;

var client = new HttpClient();
var resp = await client.GetAsync("http://localhost:3000/items/1");
if (resp.IsSuccessStatusCode) {
    var json = await resp.Content.ReadAsStringAsync();
    var item = JsonSerializer.Deserialize<Item>(json);
    Console.WriteLine(item.Name);
}
```

### Other Clients

Any language that can make HTTP calls (Python `requests`, Java `HttpClient`, etc.) will work.

---

## Contributing

Feel free to open issues or PRs for additional policies, endpoints, or integrations.

---

## License

MIT 

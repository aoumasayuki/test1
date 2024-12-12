import { serve } from '@hono/node-server'
import { Hono } from 'hono'

// ユーザーデータの型を定義
type User = {
  id: number
  name: string
  email: string
  age: number
  address: {
    street: string
    city: string
    country: string
  }
}

const app = new Hono()

// ルートエンドポイント
app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// /api/v1/userエンドポイント
app.get('/api/v1/user', (c) => {//
  // 仮のユーザーデータを型に基づいて作成
  const fakeUserData: User = {
    id: 1,
    name: 'John Doe',
    email: 'john.doe@example.com',
    age: 30,
    address: {
      street: '123 Main St',
      city: 'Hono City',
      country: 'HonoLand',
    },
  }
  
  return c.json(fakeUserData) // JSONレスポンスを返す
})
app.post('/api/v1/user', async (c) => {
  // リクエストボディをパース
  const userData = await c.req.json<User>() // User 型で受け取る
  console.log('Received user data:', userData)

  // 必要であればデータの検証や処理を追加

  // レスポンスとして受け取ったデータを返す
  return c.json({
    message: 'User data received successfully!',
    data: userData,
  })
})
const port = 3000
console.log(`Server is running on http://localhost:${port}`)

// サーバーの起動
serve({
  fetch: app.fetch,
  port,
})

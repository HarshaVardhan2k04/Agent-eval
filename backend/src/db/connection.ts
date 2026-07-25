import pg from 'pg'
import { config } from '../config.js'

const pool = new pg.Pool({ connectionString: config.databaseUrl })

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params)
}

export async function getClient() {
  return pool.connect()
}

export { pool }

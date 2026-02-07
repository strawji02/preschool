import OpenAI from 'openai'

// Initialize OpenAI client (lazy initialization for edge runtime compatibility)
let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured')
    }
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

/**
 * Generate embedding vector for semantic search
 * @param text - Text to embed (product name or search query)
 * @returns 384-dimensional embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const openai = getOpenAIClient()

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 384,
    })

    return response.data[0].embedding
  } catch (error) {
    console.error('Failed to generate embedding:', error)
    throw new Error('Embedding generation failed')
  }
}

/**
 * Batch generate embeddings for multiple texts
 * @param texts - Array of texts to embed
 * @returns Array of 384-dimensional embedding vectors
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const openai = getOpenAIClient()

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
      dimensions: 384,
    })

    return response.data.map(item => item.embedding)
  } catch (error) {
    console.error('Failed to generate embeddings:', error)
    throw new Error('Batch embedding generation failed')
  }
}

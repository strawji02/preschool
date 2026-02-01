'use client'

export interface PageImage {
  pageNumber: number
  dataUrl: string  // Base64 data URL
  width: number
  height: number
}

/**
 * PDF 파일에서 페이지별 이미지 추출
 */
export async function extractPagesFromPDF(file: File): Promise<PageImage[]> {
  // 동적 임포트로 클라이언트에서만 로드
  const pdfjsLib = await import('pdfjs-dist')

  // PDF.js 워커 설정 - 로컬 파일 사용 (PDF.js 5.x 호환)
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: PageImage[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 }) // 고해상도

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise

    pages.push({
      pageNumber: i,
      dataUrl: canvas.toDataURL('image/png'),
      width: viewport.width,
      height: viewport.height,
    })
  }

  return pages
}

/**
 * Base64 data URL에서 순수 Base64 문자열 추출
 */
export function extractBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '')
}

/**
 * 이미지 파일을 Base64로 변환
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * 이미지 파일에서 PageImage 배열 생성
 */
export async function extractPagesFromImages(files: File[]): Promise<PageImage[]> {
  const pages: PageImage[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const dataUrl = await fileToBase64(file)

    // 이미지 크기 가져오기
    const dimensions = await getImageDimensions(dataUrl)

    pages.push({
      pageNumber: i + 1,
      dataUrl,
      width: dimensions.width,
      height: dimensions.height,
    })
  }

  return pages
}

/**
 * 단일 이미지 파일을 PageImage로 변환
 */
export async function imageFileToPage(file: File, pageNumber: number = 1): Promise<PageImage> {
  const dataUrl = await fileToBase64(file)
  const dimensions = await getImageDimensions(dataUrl)

  return {
    pageNumber,
    dataUrl,
    width: dimensions.width,
    height: dimensions.height,
  }
}

/**
 * 이미지 크기 가져오기
 */
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = reject
    img.src = dataUrl
  })
}

/**
 * 파일이 PDF인지 확인
 */
export function isPDF(file: File): boolean {
  return file.type === 'application/pdf'
}

/**
 * 파일이 이미지인지 확인
 */
export function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * 지원되는 파일 타입인지 확인
 */
export function isSupportedFile(file: File): boolean {
  return isPDF(file) || isImage(file)
}

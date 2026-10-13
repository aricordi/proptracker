// Phone photos are often 3–8 MB. Shrink to a 1600px JPEG (~300 KB) before uploading:
// faster upload, faster prop pages. If the browser can't read the file, upload it as is.
export async function shrinkPhoto(file: File, maxPx = 1600): Promise<Blob> {
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url
    })
    URL.revokeObjectURL(url)
    let { naturalWidth: w, naturalHeight: h } = img
    if (!w || !h) return file
    const scale = Math.min(1, maxPx / Math.max(w, h))
    w = Math.round(w * scale); h = Math.round(h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

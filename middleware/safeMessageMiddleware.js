// middlewares/whatsappSafeMiddleware.js

import path from 'path'
import fs from 'fs'

/**
 * 🧹 Clean and validate WhatsApp text message
 * @param {string} text
 * @returns {string|false}
 */
function sanitizeTextMessage(text) {
  if (!text || typeof text !== 'string') return false

  // Trim & normalize spaces
  let clean = text.trim().replace(/\s+/g, ' ')

  // Remove HTML / script tags
  clean = clean.replace(/[<>]/g, '').replace(/javascript:/gi, '')

  // Limit message length to avoid abuse
  if (clean.length > 2000) clean = clean.substring(0, 2000) + '...'

  // Prevent excessive links
  const links = clean.match(/https?:\/\/[^\s]+/g)
  if (links && links.length > 3) return false

  // Block bad words (you can extend this list)
  const blocked = ['scam', 'hack', 'bitcoin', 'porn', 'nude']
  if (blocked.some(w => clean.toLowerCase().includes(w))) return false
  return clean
}


function validateMedia(media) {
  if (!media) return false

  const { mimetype, filePath } = media

  if (!mimetype || !filePath) return false

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'application/pdf',
    'video/mp4',
  ]

  // Block unsupported file types
  if (!allowedTypes.includes(mimetype)) return false

  // Check file size (limit to 10MB)
  const stats = fs.statSync(filePath)
  if (stats.size > 10 * 1024 * 1024) return false

  return media
}


export function whatsappSafeMiddleware(req, res, next) {
  const { body, media } = req.body

  // Case 1: Text message
  if (body && !media) {
    const clean = sanitizeTextMessage(body)
    if (!clean) {
      return res.status(400).json({ error: 'Unsafe or invalid text message' })
    }
    req.body.message = clean
    return next()
  }

  // Case 2: Media message
  if (media) {
    const validMedia = validateMedia(media)
    if (!validMedia) {
      return res.status(400).json({ error: 'Unsafe or invalid media file' })
    }
    req.body.media = validMedia
    return next()
  }

  // Nothing valid
  return res.status(400).json({ error: 'No valid message or media provided' })
}

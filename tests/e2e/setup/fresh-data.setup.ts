// Fresh test data before the crawl (the crawl's roles run side by side, so they can't each reseed).
// Journeys reseed per file themselves. Never touches the live database (see helpers.ts reseed).
import { test as setup } from '@playwright/test'
import { reseed } from '../helpers'

setup('fresh test data', () => reseed())

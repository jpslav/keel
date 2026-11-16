import { describe, expect, it } from 'vitest'
import { tabMount } from './tab-mount'

const plain = { id: 'plain' }
const kept = { id: 'kept', keepMounted: true }

describe('tabMount', () => {
    it('shows the active tab of an expanded panel, kept-mounted or not', () => {
        expect(tabMount(plain, { activeTab: 'plain', collapsed: false, pageLoaded: true })).toBe('shown')
        expect(tabMount(kept, { activeTab: 'kept', collapsed: false, pageLoaded: true })).toBe('shown')
    })

    it('mounts a keepMounted tab from the start, hidden, before anyone has opened it', () => {
        expect(tabMount(kept, { activeTab: 'people', collapsed: true, pageLoaded: true })).toBe('hidden')
        expect(tabMount(kept, { activeTab: 'people', collapsed: false, pageLoaded: true })).toBe('hidden')
    })

    it('waits for the host page to finish loading before mounting a hidden keepMounted tab', () => {
        expect(tabMount(kept, { activeTab: 'people', collapsed: true, pageLoaded: false })).toBe('none')
        // ...but opening the tab before then shows it at once.
        expect(tabMount(kept, { activeTab: 'kept', collapsed: false, pageLoaded: false })).toBe('shown')
    })

    it('keeps a keepMounted tab mounted, hidden, across tab switches and collapse', () => {
        expect(tabMount(kept, { activeTab: 'jobs', collapsed: false, pageLoaded: true })).toBe('hidden')
        expect(tabMount(kept, { activeTab: 'kept', collapsed: true, pageLoaded: true })).toBe('hidden')
    })

    it('unmounts an ordinary tab whenever it is not the shown one', () => {
        expect(tabMount(plain, { activeTab: 'jobs', collapsed: false, pageLoaded: true })).toBe('none')
        expect(tabMount(plain, { activeTab: 'plain', collapsed: true, pageLoaded: true })).toBe('none')
    })
})

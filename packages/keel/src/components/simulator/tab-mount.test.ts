import { describe, expect, it } from 'vitest'
import { tabMount } from './tab-mount'

const plain = { id: 'plain' }
const sticky = { id: 'sticky', keepMounted: true }
const none = new Set<string>()
const visited = new Set(['plain', 'sticky'])

describe('tabMount', () => {
    it('shows the active tab of an expanded panel, kept-mounted or not', () => {
        expect(tabMount(plain, { activeTab: 'plain', collapsed: false, visited: none })).toBe('shown')
        expect(tabMount(sticky, { activeTab: 'sticky', collapsed: false, visited: none })).toBe('shown')
    })

    it('never mounts a keepMounted tab that has not been opened yet', () => {
        expect(tabMount(sticky, { activeTab: 'people', collapsed: false, visited: none })).toBe('none')
        expect(tabMount(sticky, { activeTab: 'sticky', collapsed: true, visited: none })).toBe('none')
    })

    it('keeps an opened keepMounted tab mounted, hidden, across tab switches and collapse', () => {
        expect(tabMount(sticky, { activeTab: 'jobs', collapsed: false, visited })).toBe('hidden')
        expect(tabMount(sticky, { activeTab: 'sticky', collapsed: true, visited })).toBe('hidden')
        expect(tabMount(sticky, { activeTab: 'jobs', collapsed: true, visited })).toBe('hidden')
    })

    it('unmounts an ordinary tab the moment it is not the shown one, visited or not', () => {
        expect(tabMount(plain, { activeTab: 'jobs', collapsed: false, visited })).toBe('none')
        expect(tabMount(plain, { activeTab: 'plain', collapsed: true, visited })).toBe('none')
    })
})

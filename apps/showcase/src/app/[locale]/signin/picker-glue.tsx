'use client'

import { PeoplePicker, type PickerPerson } from 'keel/components/auth/people-picker'

export function PickerGlue({ people, returnTo }: { people: PickerPerson[]; returnTo: string }) {
    return (
        <PeoplePicker
            people={people}
            onPick={(personId) => {
                void fetch('/api/auth/dev-signin', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ personId }),
                }).then((response) => {
                    if (response.ok) window.location.assign(returnTo)
                })
            }}
        />
    )
}

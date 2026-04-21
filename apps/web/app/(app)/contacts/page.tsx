'use client';

/**
 * Contacts page. v0 surfaces four panels on one screen:
 *   - send a request (form)
 *   - incoming requests (accept / decline)
 *   - outgoing requests (cancel)
 *   - current contacts (remove)
 *
 * Cross-panel coordination is handled with refresh keys — the parent holds
 * one per panel and bumps it when a sibling action should force a reload.
 * For the accept case we additionally call an imperative ref on the
 * contacts list so the new contact shows up without waiting on a refetch.
 */

import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { SendContactRequest } from '@/components/send-contact-request';
import { IncomingRequests } from '@/components/incoming-requests';
import { OutgoingRequests } from '@/components/outgoing-requests';
import {
  ContactsList,
  type ContactsListHandle,
} from '@/components/contacts-list';

export default function ContactsPage() {
  const { session } = useAuth();
  const [outgoingKey, setOutgoingKey] = useState(0);
  const [incomingKey, setIncomingKey] = useState(0);
  const [contactsKey, setContactsKey] = useState(0);
  const contactsRef = useRef<ContactsListHandle>(null);

  if (!session) return null; // layout already gated on this

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Home-mode posts are only visible to people you&apos;re mutual
          contacts with. Send a request; when they accept you&apos;ll both
          see each other&apos;s Home posts.
        </p>
      </section>

      <section className="rounded-lg border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-muted))] p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[hsl(var(--text-muted))]">
          Send a request
        </h2>
        <SendContactRequest
          onSent={() => setOutgoingKey((k) => k + 1)}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Incoming</h2>
          <IncomingRequests
            refreshKey={incomingKey}
            onAccepted={(contact) => {
              contactsRef.current?.prependContact(contact);
              // Still bump contacts key so any indirect changes reconcile
              // on the next natural refresh cycle.
              setContactsKey((k) => k + 1);
            }}
            onDeclined={() => {
              // Nothing else to refresh — declines don't create a contact.
            }}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Outgoing</h2>
          <OutgoingRequests
            refreshKey={outgoingKey}
            onCancelled={() => {
              // Local drop already happened; no sibling needs refresh.
            }}
          />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your contacts</h2>
        <ContactsList
          ref={contactsRef}
          refreshKey={contactsKey}
          onRemoved={() => {
            // Bump incoming too in case the removed contact had a lingering
            // request we want to re-surface (they can re-request after 24h).
            setIncomingKey((k) => k + 1);
          }}
        />
      </section>
    </div>
  );
}

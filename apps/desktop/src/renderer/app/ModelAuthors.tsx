import type { JSX } from 'react';
import type { AppServerModelAuthor, ResearchProviderModelCatalog } from '@shared/types';
import { researchModelDisplayName } from '../lib/formatting';
import { ProviderIcon } from './ProviderIcon';

export function ModelAuthors({ authors, providerModelCatalog = [] }: {
  authors?: readonly AppServerModelAuthor[];
  providerModelCatalog?: readonly ResearchProviderModelCatalog[];
}): JSX.Element {
  return (
    <div className="model-authors" aria-label="Model authors">
      <span className="model-authors-label">Authored by</span>
      {authors?.length ? (
        <span className="model-author-list">
          {authors.map((author) => (
            <span
              className="model-author-chip"
              key={`${author.provider}\0${author.model}`}
              title={`${author.provider}/${author.model}`}
            >
              <ProviderIcon provider={author.provider || author.model} size={13} aria-hidden="true" />
              <span>{researchModelDisplayName(author.provider, author.model, providerModelCatalog)}</span>
            </span>
          ))}
        </span>
      ) : <span className="model-authors-unrecorded">Not recorded</span>}
    </div>
  );
}

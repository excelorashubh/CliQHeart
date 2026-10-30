import { useEffect, useMemo, useRef, useState } from 'react';
import { contentApi } from '../services/api.js';

function extractTags(caption) {
  return [...new Set(
    [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)]
      .map((match) => match[1].normalize('NFKC').toLocaleLowerCase('en-US'))
      .filter((tag) => tag.length <= 50),
  )];
}

function normalizeDuplicateTags(caption) {
  const seen = new Set();
  return caption.replace(/#[\p{L}\p{N}_]+/gu, (match) => {
    const tag = match.slice(1).normalize('NFKC').toLocaleLowerCase('en-US');
    if (seen.has(tag)) return '';
    seen.add(tag);
    return match;
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function HashtagComposer({ caption, onChange, disabled, maxLength }) {
  const textareaRef = useRef(null);
  const [activeToken, setActiveToken] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const tags = useMemo(() => extractTags(caption), [caption]);
  const query = activeToken?.query;
  const hasActiveToken = activeToken !== null;

  useEffect(() => {
    if (!hasActiveToken) {
      setSuggestions([]);
      setSearching(false);
      setSuggestionError('');
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSuggestionError('');
      try {
        const result = query
          ? await contentApi.searchHashtags(query, { signal: controller.signal })
          : await contentApi.trendingHashtags({ signal: controller.signal });
        if (!controller.signal.aborted) setSuggestions(result.hashtags || []);
      } catch (reason) {
        if (!controller.signal.aborted && reason.name !== 'AbortError') {
          setSuggestions([]);
          setSuggestionError(reason.message || 'Could not load hashtag suggestions.');
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasActiveToken, query]);

  function updateActiveToken(textarea) {
    const prefix = textarea.value.slice(0, textarea.selectionStart);
    const match = /(?:^|\s)#([\p{L}\p{N}_]*)$/u.exec(prefix);
    if (!match) {
      setActiveToken(null);
      return;
    }
    setActiveToken({
      start: match.index + match[0].lastIndexOf('#'),
      end: textarea.selectionStart,
      query: match[1],
    });
  }

  function selectTag(value) {
    const normalized = String(value).normalize('NFKC').toLocaleLowerCase('en-US');
    if (!/^[\p{L}\p{N}_]{1,50}$/u.test(normalized)) return;
    const textarea = textareaRef.current;
    const currentCaption = textarea?.value ?? caption;
    const cursor = textarea?.selectionStart ?? currentCaption.length;
    const token = /(?:^|\s)#([\p{L}\p{N}_]*)$/u.exec(currentCaption.slice(0, cursor));
    const tokenStart = token
      ? cursor - token[0].length + token[0].lastIndexOf('#')
      : activeToken?.start;
    const tokenEnd = token ? cursor : activeToken?.end;
    const nextCaption = tokenStart !== undefined && tokenEnd !== undefined
      ? `${currentCaption.slice(0, tokenStart)}#${normalized} ${currentCaption.slice(tokenEnd)}`
      : `${currentCaption}${currentCaption && !/\s$/.test(currentCaption) ? ' ' : ''}#${normalized} `;
    const normalizedCaption = normalizeDuplicateTags(nextCaption);
    if (extractTags(normalizedCaption).length > 30) return;
    onChange(normalizedCaption);
    setActiveToken(null);
  }

  function removeTag(tag) {
    const expression = new RegExp(`#${escapeRegex(tag)}(?![\\p{L}\\p{N}_])`, 'giu');
    onChange(caption.replace(expression, ''));
  }

  function handleChange(event) {
    onChange(event.target.value);
    updateActiveToken(event.target);
  }

  const exactMatch = query
    ? suggestions.some((item) => item.normalizedName === query.normalize('NFKC').toLocaleLowerCase('en-US'))
    : false;
  const canCreate = Boolean(query && /^[\p{L}\p{N}_]{1,50}$/u.test(query) && !exactMatch);
  const tooManyTags = tags.length > 30;

  return <div
    className="hashtag-composer"
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
        setActiveToken(null);
      }
    }}
  >
    <textarea
      ref={textareaRef}
      aria-label="Caption"
      rows="5"
      maxLength={maxLength}
      value={caption}
      onChange={handleChange}
      onClick={(event) => updateActiveToken(event.currentTarget)}
      onKeyUp={(event) => updateActiveToken(event.currentTarget)}
      disabled={disabled}
    />
    {tags.length > 0 && <div className="hashtag-selected-list" aria-label="Hashtags in caption">
      {tags.map((tag) => <button
        key={tag}
        type="button"
        className="hashtag-chip"
        onClick={() => removeTag(tag)}
        disabled={disabled}
        aria-label={`Remove hashtag ${tag}`}
        title={`Remove #${tag}`}
      >#{tag}<span aria-hidden="true">×</span></button>)}
    </div>}
    {activeToken !== null && <div className="hashtag-suggestion-list" role="listbox" aria-label="Hashtag suggestions">
      {searching && <span className="hashtag-suggestion-status" role="status">Searching hashtags…</span>}
      {suggestionError && <span className="hashtag-suggestion-status" role="alert">{suggestionError}</span>}
      {!searching && suggestions.map((item) => <button
        type="button"
        role="option"
        aria-selected="false"
        key={item.normalizedName}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectTag(item.normalizedName)}
      ><span>#{item.name}</span><small>{item.usageCount} {item.usageCount === 1 ? 'post' : 'posts'}</small></button>)}
      {!searching && canCreate && <button
        type="button"
        role="option"
        aria-selected="false"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectTag(query)}
      ><span>Create #{query}</span><small>Use this hashtag</small></button>}
      {!searching && !suggestions.length && !canCreate && <span className="hashtag-suggestion-status">No matching hashtags.</span>}
    </div>}
    {tooManyTags && <small className="form-error" role="alert">Use no more than 30 unique hashtags.</small>}
    {!tooManyTags && <small className="hashtag-composer-help">Type # to find or add hashtags. Click a hashtag below to remove it.</small>}
  </div>;
}

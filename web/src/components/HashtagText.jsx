import { Link } from 'react-router-dom';

const hashtagPattern = /^(#[\p{L}\p{N}_]+)$/u;

export function HashtagText({ children }) {
  const caption = String(children ?? '');
  return caption.split(/(#[\p{L}\p{N}_]+)/gu).map((part, index) => {
    const match = hashtagPattern.exec(part);
    if (!match) return part;
    const normalized = match[1].slice(1).normalize('NFKC').toLocaleLowerCase('en-US');
    return <Link className="caption-hashtag" to={`/explore/tags/${encodeURIComponent(normalized)}`} key={`${index}-${normalized}`}>
      {match[1]}
    </Link>;
  });
}

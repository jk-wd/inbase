import { explainBodyParagraphs } from '../explain'

export function ExplainBody({
  body,
  className,
}: {
  body: string
  className?: string
}) {
  const paragraphs = explainBodyParagraphs(body)
  if (paragraphs.length === 0) return null
  return (
    <div className={['explain-bodies', className].filter(Boolean).join(' ')}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="explain-body">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

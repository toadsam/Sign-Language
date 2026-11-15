export function validateGenerationText(text:string):string{
  const value=text.trim();
  if(!value)throw new Error('단어를 입력해주세요.');
  if(Array.from(value).length>200)throw new Error('입력은 200자 이하로 입력해주세요.');
  return value;
}

export function validateGenerationText(text:string):string{
  const value=text.trim();
  if(!value)throw new Error('문장을 입력해주세요.');
  if(Array.from(value).length>200)throw new Error('문장은 200자 이하로 입력해주세요.');
  return value;
}

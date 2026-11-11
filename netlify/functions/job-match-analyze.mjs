import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { JOB_MATCH_INSTRUCTIONS, verifyEducationClaims } from "./lib/job-match-report.mjs";
import { reserveAnalysis } from "./lib/job-match-limit.mjs";
const branches = new Set(["Navy","Army","Air Force","Marine Corps","Coast Guard","Space Force"]);
const json = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
export default async function handler(request){
  if(request.method!=="POST") return json({error:"Method not allowed"},405);
  if(Number(request.headers.get("content-length")||0)>20000) return json({error:"Request too large"},413);
  let data;
  try {
    const raw=await request.text();
    if(raw.length>20000)return json({error:"Request too large"},413);
    data=JSON.parse(raw);
    if(!data||typeof data!=="object"||Array.isArray(data))return json({error:"Invalid request"},400);
  }catch{return json({error:"Invalid request"},400)}
  const branch=String(data.branch||"").trim(),specialty=String(data.specialty||"").trim().slice(0,100);
  if(String(data.specialty||"").length>100||String(data.duties||"").length>2000||String(data.certifications||"").length>500)return json({error:"Input exceeds the allowed length"},400);
  const duties=String(data.duties||"").trim().slice(0,2000),certifications=String(data.certifications||"").trim().slice(0,500);
  const job=String(data.jobDescription||"").trim().slice(0,10000);
  if(!branches.has(branch)||!specialty||job.length<80||String(data.jobDescription||"").length>10000) return json({error:"Choose a branch and specialty, and paste a job description of at least 80 characters (maximum 10,000)."},400);
  if(!process.env.OPENAI_API_KEY) return json({error:"Analyzer temporarily unavailable"},503);
  // Claim the shared per-IP hourly allowance atomically before calling OpenAI.
  const ip=request.headers.get("x-nf-client-connection-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if(!ip) return json({error:"Unable to verify request origin"},429);
  const key=createHash("sha256").update(ip).digest("hex");
  const windowId=Math.floor(Date.now()/3600000);
  try {
    const store=getStore("job-match-rate-limits");
    const id=windowId+"-"+key;
    if(!await reserveAnalysis(store,id))return json({error:"Hourly free analysis limit reached. Please try again later."},429);
  } catch(e) {
    console.error("Rate limit store unavailable",e?.name);
    return json({error:"Analyzer temporarily unavailable. Please try again later."},503);
  }

  try{
    const ai=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:20000,maxRetries:0});
    const result=await ai.responses.create({
      model:process.env.JOB_MATCH_MODEL||"gpt-4.1-mini",
      max_output_tokens:1300,
      instructions:JOB_MATCH_INSTRUCTIONS,
      input:JSON.stringify({branch,specialty,duties,certifications,jobDescription:job})
    });
    const raw=(result.output_text||"").replace(/^\s*```(?:json)?|\s*```\s*$/g,"").trim();
    const report=JSON.parse(raw);
    if(!report||typeof report.summary!=="string")throw Error("Invalid result");
    return json({report:verifyEducationClaims(report)});
  }catch(error){console.error("Job match analysis failed",error?.name);return json({error:"Analysis could not be completed. Please try again."},502)}
}
export const config={path:"/.netlify/functions/job-match-analyze"};

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${ROOT_DIR}/scripts/lib/cli.sh"

AWS_REGION="${AWS_REGION:-us-east-2}"
AWS_AZ="${AWS_AZ:-${AWS_REGION}a}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.nano}"
ROOT_VOLUME_SIZE_GB="${ROOT_VOLUME_SIZE_GB:-8}"

usage() {
  cat <<EOF
Usage: scripts/provision-aws.sh

Environment overrides:
  DOMAIN               Public domain name
  AWS_REGION           AWS region (default: us-east-2)
  AWS_AZ               Availability zone (default: \${AWS_REGION}a)
  INSTANCE_TYPE        EC2 instance type (default: t4g.nano)
  ROOT_VOLUME_SIZE_GB  Root EBS volume size (default: 8)
  INSTANCE_NAME        Name tag for the instance
  KEY_NAME             EC2 key pair name
  SECURITY_GROUP_NAME  Security group name
  PUBLIC_KEY_PATH      Local SSH public key to import
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

first_line() {
  awk 'NF { print; exit }'
}

cli_require_cmd aws "Install and configure the AWS CLI, then re-run this script."

for name in APP_NAME DOMAIN INSTANCE_NAME KEY_NAME SECURITY_GROUP_NAME \
  PUBLIC_KEY_PATH; do
  cli_require_env "${name}"
done

cli_banner "AWS provision" "${INSTANCE_NAME}"
cli_kv "region" "${AWS_REGION}"
cli_kv "availability zone" "${AWS_AZ}"
cli_kv "instance type" "${INSTANCE_TYPE}"
cli_kv "domain" "${DOMAIN}"

cli_step "Finding latest Amazon Linux 2023 ARM AMI"
ami_id=$(
  aws ec2 describe-images \
    --owners amazon \
    --region "${AWS_REGION}" \
    --filters \
      "Name=name,Values=al2023-ami-2023*-kernel-6.1-arm64" \
      "Name=architecture,Values=arm64" \
      "Name=root-device-type,Values=ebs" \
      "Name=virtualization-type,Values=hvm" \
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' \
    --output text
)

if [[ -z "${ami_id}" || "${ami_id}" == "None" ]]; then
  cli_die "Unable to find a suitable Amazon Linux 2023 ARM AMI." \
    "Check AWS_REGION and AWS CLI credentials."
fi

cli_step "Resolving default VPC and subnet"
vpc_id=$(
  aws ec2 describe-vpcs \
    --region "${AWS_REGION}" \
    --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' \
    --output text
)

subnet_id=$(
  aws ec2 describe-subnets \
    --region "${AWS_REGION}" \
    --filters \
      "Name=vpc-id,Values=${vpc_id}" \
      "Name=availability-zone,Values=${AWS_AZ}" \
      "Name=default-for-az,Values=true" \
    --query 'Subnets[0].SubnetId' \
    --output text
)

if [[ -z "${subnet_id}" || "${subnet_id}" == "None" ]]; then
  cli_die "Unable to find a default subnet in ${AWS_AZ}." \
    "Choose an availability zone with a default subnet or create one first."
fi

cli_step "Ensuring EC2 key pair"
if ! aws ec2 describe-key-pairs \
  --region "${AWS_REGION}" \
  --key-names "${KEY_NAME}" >/dev/null 2>&1; then
  aws ec2 import-key-pair \
    --region "${AWS_REGION}" \
    --key-name "${KEY_NAME}" \
    --public-key-material "fileb://${PUBLIC_KEY_PATH}" >/dev/null
fi

cli_step "Ensuring security group and public web ingress"
security_group_id=$(
  aws ec2 describe-security-groups \
    --region "${AWS_REGION}" \
    --filters \
      "Name=group-name,Values=${SECURITY_GROUP_NAME}" \
      "Name=vpc-id,Values=${vpc_id}" \
    --query 'SecurityGroups[0].GroupId' \
    --output text
)

if [[ -z "${security_group_id}" || "${security_group_id}" == "None" ]]; then
  security_group_id=$(
    aws ec2 create-security-group \
      --region "${AWS_REGION}" \
      --group-name "${SECURITY_GROUP_NAME}" \
      --description "Public web access for ${APP_NAME}" \
      --vpc-id "${vpc_id}" \
      --tag-specifications \
        "ResourceType=security-group,Tags=[{Key=Name,Value=${SECURITY_GROUP_NAME}},{Key=Project,Value=${APP_NAME}}]" \
      --query 'GroupId' \
      --output text
  )
fi

for port in 22 80 443; do
  aws ec2 authorize-security-group-ingress \
    --region "${AWS_REGION}" \
    --group-id "${security_group_id}" \
    --ip-permissions \
      "[{\"IpProtocol\":\"tcp\",\"FromPort\":${port},\"ToPort\":${port},\"IpRanges\":[{\"CidrIp\":\"0.0.0.0/0\"}],\"Ipv6Ranges\":[{\"CidrIpv6\":\"::/0\"}]}]" \
    >/dev/null 2>&1 || true
done

cli_step "Finding or creating EC2 instance"
instance_id=$(
  aws ec2 describe-instances \
    --region "${AWS_REGION}" \
    --filters \
      "Name=tag:Name,Values=${INSTANCE_NAME}" \
      "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' \
    --output text | first_line
)

if [[ "${instance_id}" == "None" ]]; then
  instance_id=""
fi

if [[ -z "${instance_id}" ]]; then
  instance_id=$(
    aws ec2 run-instances \
      --region "${AWS_REGION}" \
      --image-id "${ami_id}" \
      --instance-type "${INSTANCE_TYPE}" \
      --key-name "${KEY_NAME}" \
      --subnet-id "${subnet_id}" \
      --security-group-ids "${security_group_id}" \
      --block-device-mappings \
        "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":${ROOT_VOLUME_SIZE_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
      --tag-specifications \
        "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=Project,Value=${APP_NAME}},{Key=Domain,Value=${DOMAIN}}]" \
        "ResourceType=volume,Tags=[{Key=Name,Value=${INSTANCE_NAME}-root},{Key=Project,Value=${APP_NAME}}]" \
      --query 'Instances[0].InstanceId' \
      --output text
  )
else
  instance_state=$(
    aws ec2 describe-instances \
      --region "${AWS_REGION}" \
      --instance-ids "${instance_id}" \
      --query 'Reservations[0].Instances[0].State.Name' \
      --output text
  )

  if [[ "${instance_state}" == "stopped" ]]; then
    aws ec2 start-instances \
      --region "${AWS_REGION}" \
      --instance-ids "${instance_id}" >/dev/null
  fi
fi

cli_step "Waiting for instance health checks"
aws ec2 wait instance-running \
  --region "${AWS_REGION}" \
  --instance-ids "${instance_id}"
aws ec2 wait instance-status-ok \
  --region "${AWS_REGION}" \
  --instance-ids "${instance_id}"

cli_step "Ensuring Elastic IP association"
allocation_id=$(
  aws ec2 describe-addresses \
    --region "${AWS_REGION}" \
    --filters "Name=tag:Name,Values=${INSTANCE_NAME}-eip" \
    --query 'Addresses[0].AllocationId' \
    --output text
)

if [[ -z "${allocation_id}" || "${allocation_id}" == "None" ]]; then
  allocation_id=$(
    aws ec2 allocate-address \
      --region "${AWS_REGION}" \
      --domain vpc \
      --tag-specifications \
        "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${INSTANCE_NAME}-eip},{Key=Project,Value=${APP_NAME}},{Key=Domain,Value=${DOMAIN}}]" \
      --query 'AllocationId' \
      --output text
  )
fi

aws ec2 associate-address \
  --region "${AWS_REGION}" \
  --instance-id "${instance_id}" \
  --allocation-id "${allocation_id}" \
  --allow-reassociation >/dev/null

public_ip=$(
  aws ec2 describe-addresses \
    --region "${AWS_REGION}" \
    --allocation-ids "${allocation_id}" \
    --query 'Addresses[0].PublicIp' \
    --output text
)

public_dns=$(
  aws ec2 describe-instances \
    --region "${AWS_REGION}" \
    --instance-ids "${instance_id}" \
    --query 'Reservations[0].Instances[0].PublicDnsName' \
    --output text
)

if [[ -t 1 ]]; then
  cli_ok "Provisioning complete"
  cli_section "Connection details"
  cli_kv "instance id" "${instance_id}"
  cli_kv "public ip" "${public_ip}"
  cli_kv "public dns" "${public_dns}"
  cli_kv "ami id" "${ami_id}"
  cli_kv "security group" "${security_group_id}"
  cli_kv "ssh target" "ec2-user@${public_ip}"
  cli_kv "deploy url" "http://${DOMAIN}"
fi

cat <<EOF
INSTANCE_ID=${instance_id}
PUBLIC_IP=${public_ip}
PUBLIC_DNS=${public_dns}
AWS_REGION=${AWS_REGION}
AWS_AZ=${AWS_AZ}
INSTANCE_TYPE=${INSTANCE_TYPE}
AMI_ID=${ami_id}
SECURITY_GROUP_ID=${security_group_id}
KEY_NAME=${KEY_NAME}
SSH_TARGET=ec2-user@${public_ip}
DEPLOY_BASE_URL=http://${DOMAIN}
EOF
